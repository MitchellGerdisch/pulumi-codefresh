import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as aws from "@pulumi/aws";
import * as rbac from "./rbac";

export type AlbIngressControllerOptions = {
    namespace: pulumi.Input<string>;
    provider: k8s.Provider;
    vpcId: pulumi.Input<string>;
    clusterName: pulumi.Input<string>;
    clusterOidcProviderArn: pulumi.Input<string>;
    clusterOidcProviderUrl: pulumi.Input<string>;
};

const pulumiComponentNamespace: string = "pulumi:AlbIngressController";

export class AlbIngressController extends pulumi.ComponentResource {
    public readonly iamRole: aws.iam.Role;
    public readonly serviceAccount: k8s.core.v1.ServiceAccount;
    public readonly serviceAccountName: pulumi.Output<string>;
    public readonly clusterRole: k8s.rbac.v1.ClusterRole;
    public readonly clusterRoleName: pulumi.Output<string>;
    public readonly clusterRoleBinding: k8s.rbac.v1.ClusterRoleBinding;
    public readonly deployment: k8s.helm.v3.Release;

    constructor(
        name: string,
        args: AlbIngressControllerOptions,
        opts?: pulumi.ComponentResourceOptions,
    ) {
        super(pulumiComponentNamespace, name, args, opts);

        // ServiceAccount
        this.iamRole = rbac.createIAM(name, args.namespace,
            args.clusterOidcProviderArn, args.clusterOidcProviderUrl);
        this.serviceAccount = rbac.createServiceAccount(name,
            args.provider, this.iamRole.arn, args.namespace);
        this.serviceAccountName = this.serviceAccount.metadata.name;

        // RBAC ClusterRole
        this.clusterRole = rbac.createClusterRole(name, args.provider);
        this.clusterRoleName = this.clusterRole.metadata.name;
        this.clusterRoleBinding = rbac.createClusterRoleBinding(
            name, args.provider, args.namespace, this.serviceAccountName, this.clusterRoleName);

        // Deployment
        const labels = { app: name };
        this.deployment = createDeployment(
            name, args.provider, args.namespace,
            this.serviceAccountName, labels, args.vpcId, args.clusterName);
    }
}

// Create a Deployment using the AWS ALB Ingress Controller Helm Chart
export function createDeployment(
    name: string,
    provider: k8s.Provider,
    namespace: pulumi.Input<string>,
    serviceAccountName: pulumi.Input<string>,
    labels: pulumi.Input<any>,
    vpcId: pulumi.Input<string>,
    clusterName: pulumi.Input<string>)
{
    const awsRegion = pulumi.output(aws.getRegion())
    const chartValues = awsRegion.name.apply(region => {
        return {
            "region": region, //"us-east-2", //pulumi.output(aws.getRegion()),
            "vpcId": vpcId,
            "clusterName": clusterName,
            "serviceAccount": {
                "create": false,
                "name": serviceAccountName
            },
            "podLabels": labels
        }
    })
    return new k8s.helm.v3.Release(name, {
        chart: "aws-load-balancer-controller",
        repositoryOpts: {
            repo: "https://aws.github.io/eks-charts",
        },
        namespace: namespace,
        values: chartValues,
    }, {provider})
}

export interface AlbSecGroupOptions {
    // The VPC in which to create the security group.
    vpcId: pulumi.Input<string>;
    // The security group of the worker node groups in the cluster that the ALBs
    // will be servicing.
    nodeSecurityGroup: aws.ec2.SecurityGroup;
    // The tags to apply to the security group.
    tags?: pulumi.Input<{[key: string]: any}>;
    // The cluster name associated with the worker node group.
    clusterName: pulumi.Input<string>;
}

export function createAlbSecurityGroup(name: string, args: AlbSecGroupOptions, parent: pulumi.ComponentResource): aws.ec2.SecurityGroup {
    const albSecurityGroup = new aws.ec2.SecurityGroup(`${name}-albSecurityGroup`, {
        vpcId: args.vpcId,
        revokeRulesOnDelete: true,
        tags: pulumi.all([
            args.tags,
            args.clusterName,
        ]).apply(([tags, clusterName]) => (<aws.Tags>{
            "Name": `${name}-albSecurityGroup`,
            [`kubernetes.io/cluster/${clusterName}`]: "owned",
            ...tags,
        })),
    }, { parent });

    const nodeAlbIngressRule = new aws.ec2.SecurityGroupRule(`${name}-nodeAlbIngressRule`, {
        description: "Allow ALBs to communicate with workers",
        type: "ingress",
        fromPort: 0,
        toPort: 65535,
        protocol: "tcp",
        securityGroupId: args.nodeSecurityGroup.id,
        sourceSecurityGroupId: albSecurityGroup.id,
    }, { parent });

    const albInternetEgressRule = new aws.ec2.SecurityGroupRule(`${name}-albInternetEgressRule`, {
        description: "Allow external internet access",
        type: "egress",
        fromPort: 0,
        toPort: 0,
        protocol: "-1",  // all
        cidrBlocks: [ "0.0.0.0/0" ],
        securityGroupId: albSecurityGroup.id,
    }, { parent });

    const albInternetHttpIngressRule = new aws.ec2.SecurityGroupRule(`${name}-albInternetHttpEgressRule`, {
        description: "Allow internet clients to communicate with ALBs over HTTP",
        type: "ingress",
        fromPort: 80,
        toPort: 80,
        protocol: "tcp",  // all
        cidrBlocks: [ "0.0.0.0/0" ],
        securityGroupId: albSecurityGroup.id,
    }, { parent });

    const albInternetHttpsIngressRule = new aws.ec2.SecurityGroupRule(`${name}-albInternetHttpsEgressRule`, {
        description: "Allow internet clients to communicate with ALBs over HTTPS",
        type: "ingress",
        fromPort: 443,
        toPort: 443,
        protocol: "tcp",  // all
        cidrBlocks: [ "0.0.0.0/0" ],
        securityGroupId: albSecurityGroup.id,
    }, { parent });

    return albSecurityGroup;
}
