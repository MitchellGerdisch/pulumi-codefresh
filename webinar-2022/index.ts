import * as pulumi from "@pulumi/pulumi"
import * as awsx from "@pulumi/awsx";
import * as eks from "@pulumi/eks";
import { local } from "@pulumi/command";
import { StackTag } from "@pulumi/pulumiservice"
import * as fs from "fs";

const config = new pulumi.Config();
const codefreshApiKey = config.getSecret("codefreshApiKey");
const org = config.get("org") || "team-ce";

const project = pulumi.getProject();
const stack = pulumi.getStack();
const name = `${project}-${stack}`;

// Create a VPC for our cluster.
const vpc = new awsx.ec2.Vpc(name, { numberOfAvailabilityZones: 2 });

// Create the EKS cluster itself and a deployment of the Kubernetes dashboard.
const cluster = new eks.Cluster(name, {
    vpcId: vpc.id,
    subnetIds: vpc.publicSubnetIds,
    instanceType: "t2.medium",
    desiredCapacity: 2,
    minSize: 1,
    maxSize: 2,
});

// If an API key for Codefresh is configured, then register the cluster with Codefresh.
if (codefreshApiKey) {
    const cfRegistration = new local.Command(`codefresh-cmd`, {
        dir: "commands",
        interpreter: [ "/bin/sh" ],
        create: "codefresh_register",
        delete: "codefresh_deregister",
        environment: {
            CODEFRESH_API_KEY: config.requireSecret("codefreshApiKey"),
            CLUSTER_KUBECONFIG_STRING: cluster.kubeconfig.apply(kubeconfig => JSON.stringify(kubeconfig))
        }
    })
}

// Set Pulumi service stack tag 
const stackTag = new StackTag(`stacktag`, {
    name: "Codefresh",
    value: name,
    organization: org,
    project: project,
    stack: stack,
});

// Export cluster's name
export const clusterName = cluster.eksCluster.name;
// Export the cluster's kubeconfig.
export const kubeconfig = pulumi.secret(cluster.kubeconfig);
