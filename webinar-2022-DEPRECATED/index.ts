import * as pulumi from "@pulumi/pulumi"
import * as aws from "@pulumi/aws"
import * as awsx from "@pulumi/awsx";
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";
import { local } from "@pulumi/command";
import { StackTag } from "@pulumi/pulumiservice"

import { config } from "./config";
import { ExternalDns } from "./external-dns";
import { AlbIngressController, createAlbSecurityGroup } from "./alb-ing-cntlr";
import * as dns from "./dns";
export const domainName = dns.domainName;

const project = pulumi.getProject();
const stack = pulumi.getStack();
const name = `${project}-${stack}`;

const tags = { "Project": "pulumi-k8s-aws-cluster", "Owner": "pulumi"};

// --- VPC and Networking ---
const vpc = new awsx.ec2.Vpc(name, { 
    subnets: [
        { type: "public", tags: {"kubernetes.io/role/elb": "1", ...tags}},
        { type: "private", tags: {"kubernetes.io/role/internal-elb": "1", ...tags}},
    ],
    numberOfAvailabilityZones: 2, 
    tags: { "Name": `${name}-vpc`, ...tags},
});
const publicSubnetIds = vpc.publicSubnetIds;
const privateSubnetIds = vpc.privateSubnetIds;

// --- Identity ---

// The managed policies EKS requires of nodegroups join a cluster.
const nodegroupManagedPolicyArns: string[] = [
    "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
    "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
];

// Create the standard node group worker role and attach the required policies.
const ngName = "standardNodeGroup";
const nodegroupIamRole = new aws.iam.Role(`${ngName}-eksClusterWorkerNode`, {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({"Service": "ec2.amazonaws.com"}),
    tags: tags,
})
attachPoliciesToRole(ngName, nodegroupIamRole, nodegroupManagedPolicyArns);

// Attach policies to a role.
function attachPoliciesToRole(name: string, role: aws.iam.Role, policyArns: string[]) {
    for (const policyArn of policyArns) {
        new aws.iam.RolePolicyAttachment(`${name}-${policyArn.split('/')[1]}`,
            { policyArn: policyArn, role: role },
        );
    }
}

// --- EKS Cluster ---
const cluster = new eks.Cluster(name, {
    version: config.clusterVersion,
    instanceRoles: [ nodegroupIamRole],
    vpcId: vpc.id,
    publicSubnetIds: vpc.publicSubnetIds,
    privateSubnetIds: vpc.privateSubnetIds,
    providerCredentialOpts: { profileName: process.env.AWS_PROFILE}, 
    skipDefaultNodeGroup: true,
    createOidcProvider: true,
    tags: tags,
});

// get the cluster OIDC provider URL.
if (!cluster?.core?.oidcProvider) {
    throw new Error("Invalid cluster OIDC provider URL");
}
const clusterOidcProvider = cluster.core.oidcProvider;
const clusterOidcProviderArn = clusterOidcProvider.arn;
const clusterOidcProviderUrl = clusterOidcProvider.url;
const clusterName = cluster.core.cluster.name;

// --- EKS Node Group ---
const ssmParam = pulumi.output(aws.ssm.getParameter({
    // https://docs.aws.amazon.com/eks/latest/userguide/retrieve-ami-id.html
    name: `/aws/service/eks/optimized-ami/${config.clusterVersion}/amazon-linux-2/recommended`,
}))
const amiId = ssmParam.value.apply(s => JSON.parse(s).image_id)

const ngStandard = new eks.NodeGroup(`${name}-ng-standard`, {
    cluster: cluster,
    instanceProfile: new aws.iam.InstanceProfile("ng-standard", {role: nodegroupIamRole}),
    nodeAssociatePublicIpAddress: false,
    nodeSecurityGroup: cluster.nodeSecurityGroup,
    clusterIngressRule: cluster.eksClusterIngressRule,
    amiId: amiId,
    
    instanceType: <aws.ec2.InstanceType>config.standardNodeGroupInstanceType,
    desiredCapacity: config.standardNodeGroupDesiredCapacity,
    minSize: config.standardNodeGroupMinSize,
    maxSize: config.standardNodeGroupMaxSize,

    labels: {"amiId": `${amiId}`},
    cloudFormationTags: clusterName.apply(clusterName => ({
        "k8s.io/cluster-autoscaler/enabled": "true",
        [`k8s.io/cluster-autoscaler/${clusterName}`]: "true",
        ...tags,
    })),
}, {
    providers: { kubernetes: cluster.provider},
});

// Instantiate K8s provider using the kubeconfig from the cluster create above. 
const provider = new k8s.Provider("k8s-provider", {kubeconfig: cluster.kubeconfig});

// --- ALB Security Group ---
const albSecurityGroup = createAlbSecurityGroup(name, {
    vpcId: vpc.id,
    nodeSecurityGroup: cluster.nodeSecurityGroup,
    clusterName: clusterName,
    tags: tags,
}, cluster);

// --- External DNS ---
const clusterSvcsNamespace = new k8s.core.v1.Namespace("cluster-svcs", undefined, { provider: cluster.provider });
const extDns = new ExternalDns("external-dns", {
    provider: provider,
    namespace: clusterSvcsNamespace.metadata.name,
    commandArgs: [
        "--source=ingress",
        "--domain-filter=" + "pulumi-ce.team", // will make ExternalDNS see only the hosted zones matching provided domain, omit to process all available hosted zones
        "--provider=aws",
        "--policy=sync",
        "--registry=txt",
        clusterName.apply(name => `--txt-owner-id=${name}`)
    ],
    clusterOidcProviderArn: clusterOidcProviderArn,
    clusterOidcProviderUrl: clusterOidcProviderUrl,
});

// --- ALB Ingress Controller ---
const albIngCntlr = new AlbIngressController(name, {
    namespace: "kube-system",
    provider: cluster.provider,
    vpcId: vpc.id,
    clusterName: cluster.eksCluster.name,
    clusterOidcProviderArn: clusterOidcProviderArn,
    clusterOidcProviderUrl: clusterOidcProviderUrl,
}, { dependsOn: [vpc, cluster]});

// --- Register Cluster with Codefresh ---
if (config.codefreshApiKey) {
    const cfRegistration = new local.Command(`codefresh-cmd`, {
        dir: "commands",
        interpreter: [ "/bin/sh" ],
        create: "codefresh_register",
        delete: "codefresh_deregister",
        environment: {
            CODEFRESH_API_KEY: config.codefreshApiKey,
            CLUSTER_KUBECONFIG_STRING: cluster.kubeconfig.apply(kubeconfig => JSON.stringify(kubeconfig))
        }
    })
}

// --- Pulumi Service Stack Tag ---
const stackTag = new StackTag(`stacktag`, {
    name: "Codefresh",
    value: name,
    organization: config.org,
    project: project,
    stack: stack,
});

// Export cluster's name
export const eksClusterName = cluster.eksCluster.name;
// Export the cluster's kubeconfig.
export const kubeconfig = pulumi.secret(cluster.kubeconfig);

export const albSecurityGroupId = albSecurityGroup.id;
export const validationCertArn = dns.validationCertArn;