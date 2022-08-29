import * as pulumi from "@pulumi/pulumi";

const pulumiConfig = new pulumi.Config();

export const config = {
    clusterVersion: pulumiConfig.get("clusterVersion") || "1.22", 

    /**
     * EKS Node Group
     */
    standardNodeGroupInstanceType: pulumiConfig.get("standardNodeGroupInstanceType") || "t3.xlarge",
    standardNodeGroupDesiredCapacity: pulumiConfig.getNumber("standardNodeGroupDesiredCapacity") ?? 1,
    standardNodeGroupMinSize: pulumiConfig.getNumber("standardNodeGroupMinSize") ?? 1,
    standardNodeGroupMaxSize: pulumiConfig.getNumber("standardNodeGroupMaxSize") ?? 5,

    pulumiNodeGroupInstanceType: pulumiConfig.get("standardNodeGroupInstanceType") || "t3.xlarge",
    pulumiNodeGroupDesiredCapacity: pulumiConfig.getNumber("pulumiNodeGroupDesiredCapacity") ?? 1,
    pulumiNodeGroupMinSize: pulumiConfig.getNumber("pulumiNodeGroupMinSize") ?? 1,
    pulumiNodeGroupMaxSize: pulumiConfig.getNumber("pulumiNodeGroupMaxSize") ?? 5,

    tags: { "Project": "pulumi-k8s-aws-cluster", "Owner": "pulumi"},
};
