import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export interface AlbSecGroupOptions {
  // The VPC in which to create the security group.
  vpcId: pulumi.Input<string>;
  // The security group of the worker node groups in the cluster that the ALBs
  // will be servicing.
  nodeSecurityGroup: aws.ec2.SecurityGroup;
  // The tags to apply to the security group.
  tags: pulumi.Input<{[key: string]: any}>;
  // The cluster name associated with the worker node group.
  clusterName: pulumi.Input<string>;
}

/**
 * Create a security group for the ALBs that can connect and work with the
 * cluster worker nodes.
 *
 * It's best to create a security group for the ALBs to share, if not the
 * ALB controller will default to creating a new one. Auto creation of
 * security groups can hit ENI limits, and is not guaranteed to be deleted by
 * Pulumi on tear downs, as the ALB controller created it out-of-band.
 *
 * See for more details:
 * https://github.com/kubernetes-sigs/aws-alb-ingress-controller/pull/1019
 *
 */
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