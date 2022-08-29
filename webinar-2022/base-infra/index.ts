import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { config } from "./config";
import * as nodePols from "./nodePolicies";
import * as albSecGrp from "./albSecGroup";

const projectName = pulumi.getProject();

// --- Networking ---

// Create a new VPC with custom settings.
const name = "pulumi";
const vpc = new awsx.ec2.Vpc(`${name}-vpc`,
    {
        cidrBlock: "172.16.0.0/16",
        numberOfAvailabilityZones: 3,
        subnets: [
            // Any non-null value is valid.
            { type: "public", tags: {"kubernetes.io/role/elb": "1", ...config.tags}},
            { type: "private", tags: {"kubernetes.io/role/internal-elb": "1", ...config.tags}},
        ],
        tags: { "Name": `${name}-vpc`, ...config.tags},
    },
    {
        transformations: [(args) => {
            if (args.type === "aws:ec2/vpc:Vpc" || args.type === "aws:ec2/subnet:Subnet") {
                return {
                    props: args.props,
                    opts: pulumi.mergeOptions(args.opts, { ignoreChanges: ["tags"] })
                }
            }
            return undefined;
        }],
    }
);

export const vpcId = vpc.id;
export const publicSubnetIds = vpc.publicSubnetIds;
export const privateSubnetIds = vpc.privateSubnetIds;

// --- EKS Cluster ---

// Create an EKS cluster.
const cluster = new eks.Cluster(`${projectName}`, {
    instanceRoles: [ nodePols.nodegroupIamRole, nodePols.pulumiNodegroupIamRole ],
    vpcId: vpcId,
    publicSubnetIds: publicSubnetIds,
    privateSubnetIds: privateSubnetIds,
    providerCredentialOpts: { profileName: process.env.AWS_PROFILE}, 
    // nodeAssociatePublicIpAddress: false,
    skipDefaultNodeGroup: true,
    deployDashboard: false,
    version: config.clusterVersion,
    createOidcProvider: true,
    tags: config.tags,
    enabledClusterLogTypes: ["api", "audit", "authenticator", "controllerManager", "scheduler"],
}, {
    transformations: [(args) => {
        if (args.type === "aws:eks/cluster:Cluster") {
            return {
                props: args.props,
                opts: pulumi.mergeOptions(args.opts, {
                    protect: true,
                })
            }
        }
        return undefined;
    }],
});

// Export the cluster details.
// export const kubeconfig = cluster.kubeconfig.apply(JSON.stringify);
export const kubeconfig = pulumi.secret(cluster.kubeconfig)
export const clusterName = cluster.core.cluster.name;
export const region = aws.config.region;
export const nodeSecurityGroupId = cluster.nodeSecurityGroup.id; // For RDS
export const nodeGroupInstanceType = config.pulumiNodeGroupInstanceType;

// Create the ALB security group.
const albSecurityGroup = albSecGrp.createAlbSecurityGroup(name, {
    vpcId: vpcId,
    nodeSecurityGroup: cluster.nodeSecurityGroup,
    tags: config.tags,
    clusterName: clusterName,
}, cluster);
export const albSecurityGroupId = albSecurityGroup.id;

// Export the cluster OIDC provider URL.
if (!cluster?.core?.oidcProvider) {
    throw new Error("Invalid cluster OIDC provider URL");
}
const clusterOidcProvider = cluster.core.oidcProvider;
export const clusterOidcProviderArn = clusterOidcProvider.arn;
export const clusterOidcProviderUrl = clusterOidcProvider.url;

// Create a standard node group.

const ssmParam = pulumi.output(aws.ssm.getParameter({
    // https://docs.aws.amazon.com/eks/latest/userguide/retrieve-ami-id.html
    name: `/aws/service/eks/optimized-ami/${config.clusterVersion}/amazon-linux-2/recommended`,
}))
const amiId = ssmParam.value.apply(s => JSON.parse(s).image_id)

const ngStandard = new eks.NodeGroup(`${projectName}-ng-standard`, {
    cluster: cluster,
    instanceProfile: new aws.iam.InstanceProfile("ng-standard", {role: nodePols.nodegroupIamRole}),
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
        ...config.tags,
    })),
}, {
    providers: { kubernetes: cluster.provider},
});

// Create a standard node group tainted for use only by self-hosted pulumi.
const ngStandardPulumi = new eks.NodeGroup(`${projectName}-ng-standard-pulumi`, {
    cluster: cluster,
    instanceProfile: new aws.iam.InstanceProfile("ng-standard-pulumi", {role: nodePols.pulumiNodegroupIamRole}),
    nodeAssociatePublicIpAddress: false,
    nodeSecurityGroup: cluster.nodeSecurityGroup,
    clusterIngressRule: cluster.eksClusterIngressRule,
    amiId: amiId,

    instanceType: <aws.ec2.InstanceType>config.pulumiNodeGroupInstanceType,
    desiredCapacity: config.pulumiNodeGroupDesiredCapacity,
    minSize: config.pulumiNodeGroupMinSize,
    maxSize: config.pulumiNodeGroupMaxSize,

    labels: {"amiId": `${amiId}`},
    taints: { "self-hosted-pulumi": { value: "true", effect: "NoSchedule"}},
    cloudFormationTags: clusterName.apply(clusterName => ({
        "k8s.io/cluster-autoscaler/enabled": "true",
        [`k8s.io/cluster-autoscaler/${clusterName}`]: "true",
        ...config.tags,
    })),
}, {
    providers: { kubernetes: cluster.provider},
});

// Create Kubernetes namespaces.
const clusterSvcsNamespace = new k8s.core.v1.Namespace("cluster-svcs", undefined, { provider: cluster.provider, protect: true });
export const clusterSvcsNamespaceName = clusterSvcsNamespace.metadata.name;

const appsNamespace = new k8s.core.v1.Namespace("apps", undefined, { provider: cluster.provider, protect: true });
export const appsNamespaceName = appsNamespace.metadata.name;

// Create a resource quota in the apps namespace.
//
// Given 2 replicas each for HA:
// API:     4096m cpu, 2048Mi ram
// Console: 2048m cpu, 1024Mi ram
//
// 2x the HA requirements to create capacity for rolling updates of replicas:
// API:     8192m cpu, 4096Mi ram
// Console: 4096m cpu, 2048Mi ram
//
// Totals:  12288m cpu, 6144Mi ram
const quotaAppsNamespace = new k8s.core.v1.ResourceQuota("apps", {
    metadata: {namespace: appsNamespaceName},
    spec: {
        hard: {
            cpu: "12288",
            memory: "6144Mi",
            pods: "20",
            resourcequotas: "1",
            services: "5",
        },
    }
},{
    provider: cluster.provider
});
