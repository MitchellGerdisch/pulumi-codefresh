import * as pulumi from "@pulumi/pulumi";

let pulumiConfig = new pulumi.Config();

// Existing Pulumi stack reference in the format:
// <organization>/<project>/<stack> e.g. "myUser/myProject/dev"
const pulumiOrg = pulumiConfig.require("org");
const clusterProjectName = pulumiConfig.require("projectName");
const clusterFullStackName = `${pulumiOrg}/${clusterProjectName}/${pulumi.getStack()}`;
const clusterStackRef = new pulumi.StackReference(clusterFullStackName);

export const config = {
    org: pulumiOrg,
    // Infra
    vpcId: clusterStackRef.requireOutput("vpcId"),
    privateSubnetIds: clusterStackRef.requireOutput("privateSubnetIds"),
    publicSubnetIds: clusterStackRef.requireOutput("publicSubnetIds"),
    nodeSecurityGroupId: clusterStackRef.requireOutput("nodeSecurityGroupId"),

    // Cluster
    kubeconfig: clusterStackRef.requireOutput("kubeconfig"),
    clusterName: clusterStackRef.requireOutput("clusterName"),
    clusterSvcsNamespaceName: clusterStackRef.requireOutput("clusterSvcsNamespaceName"),
    appsNamespaceName: clusterStackRef.requireOutput("appsNamespaceName"),
    clusterOidcProviderArn: clusterStackRef.requireOutput("clusterOidcProviderArn"),
    clusterOidcProviderUrl: clusterStackRef.requireOutput("clusterOidcProviderUrl"),

    // ALB Security Group ID
    albSecurityGroupId: clusterStackRef.requireOutput("albSecurityGroupId"),

    //// // RDS Cluster Instances
    // dbReplicas: pulumiConfig.getNumber("dbReplicas") ?? 2,
    //// dbInstanceType: pulumiConfig.get("dbInstanceType") || "db.r4.xlarge",

    // DNS Hosted Zone to manage with external-dns and use with ALB, ACM.
    hostedZoneDomainName: pulumiConfig.require("hostedZoneDomainName"), 
    hostedZoneDomainSubdomain: pulumiConfig.require("hostedZoneDomainSubdomain"), 

    // Codefresh API Key
    codefreshApiKey: pulumiConfig.getSecret("codefreshApiKey"),
};
