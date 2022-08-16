import * as pulumi from "@pulumi/pulumi"
import * as awsx from "@pulumi/awsx";
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";
import { local } from "@pulumi/command";
import { StackTag } from "@pulumi/pulumiservice"
import * as fs from "fs";

import { AlbIngressController } from "./alb-ing-cntlr";
import * as dns from "./dns";
export const domainName = dns.domainName;

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
    createOidcProvider: true,
});

// get the cluster OIDC provider URL.
if (!cluster?.core?.oidcProvider) {
    throw new Error("Invalid cluster OIDC provider URL");
}
const clusterOidcProvider = cluster.core.oidcProvider;
const clusterOidcProviderArn = clusterOidcProvider.arn;
const clusterOidcProviderUrl = clusterOidcProvider.url;

// Instantiate K8s provider using the kubeconfig from the cluster create above. 
const provider = new k8s.Provider("k8s-provider", {kubeconfig: cluster.kubeconfig});

// Deploy ALB Ingress Controller.
const albIngCntlr = new AlbIngressController(name, {
    namespace: "kube-system",
    provider: cluster.provider,
    vpcId: vpc.id,
    clusterName: cluster.eksCluster.name,
    clusterOidcProviderArn: clusterOidcProviderArn,
    clusterOidcProviderUrl: clusterOidcProviderUrl,
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
