import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import { projectName, codefreshApiKey } from "./config";
import { K8sCluster } from "./k8s-cluster";
import { setAuth, CodefreshK8sDashboard } from "./codefresh-k8s-dashboard"

// Instantiate a GKE cluster 
const k8sCluster = new K8sCluster(projectName, {
    projectName: projectName
})

// Create a Kubernetes Namespace using Pulumi's native k8s provider.
const namespace = new k8s.core.v1.Namespace(projectName, {
    metadata: {
        name: projectName,
    }
}, { dependsOn: k8sCluster, provider: k8sCluster.provider });
export const namespaceName = namespace.metadata.name;

// Create configmap
const configMap = new k8s.core.v1.ConfigMap(projectName, {
    metadata: {
        namespace: namespaceName,
    },
    data: { storageBucketName: k8sCluster.bucketName },
}, { provider: k8sCluster.provider });

 // Create a NGINX Deployment using pulumi/k8s provider
const appLabels = { appClass: projectName };
const deployment = new k8s.apps.v1.Deployment(projectName, {
    metadata: {
        namespace: namespaceName,
        labels: appLabels,
    },
    spec: {
        replicas: 1,
        selector: { matchLabels: appLabels },
        template: {
            metadata: {
                labels: appLabels,
            },
            spec: {
                containers: [{
                    name: projectName,
                    image: "nginx:1.18", // other versions to try 1.18 -> 1.19
                    ports: [{ containerPort: 80, name: "http" }],
                    envFrom: [{ configMapRef: { name: configMap.metadata.apply(m => m.name) } }],
                }],
            },
        },
    },
}, { parent: namespace });

// Create a LoadBalancer Service for the NGINX Deployment
const nginxLb = new k8s.core.v1.Service(`${projectName}-nginx-lb`, {
    metadata: {
        labels: appLabels,
        namespace: namespaceName,
    },
    spec: {
        type: "LoadBalancer",
        ports: [{ port: 80, targetPort: "http" }],
        selector: appLabels,
    },
}, { parent: deployment });
// Get and output the link to this deployment.
const nginxLbIngress = nginxLb.status.loadBalancer.ingress[0]
const nginxLbIp = nginxLbIngress.apply(x => x.ip ?? x.hostname)
export const nginxLbUrl = pulumi.interpolate`http://${nginxLbIp}`

// Use Pulumi's native k8s/helm provider to deploy a Helm chart for an nginx website.
const chartName = "nginx"
const helmAppName = `${projectName}-website`
const helmApp = new k8s.helm.v3.Chart(helmAppName, {
    chart: chartName,
    version: "8.2.3",
    namespace: namespaceName,
    fetchOpts: {
        repo: "https://charts.bitnami.com/bitnami",
    },
    values: {
        cloneStaticSiteFromGit: {
            enabled: true,
            repository: "https://github.com/MitchellGerdisch/simple_static_website.git",
            branch: "main"
        }
    },
}, { parent: namespace});
// Create and output the URL for the chart-based website.
const helmResourceName = pulumi.interpolate`${namespaceName}/${helmAppName}-${chartName}`
const helmAppFrontend = helmResourceName.apply(name => helmApp.getResourceProperty("v1/Service", name, "status"))
const helmAppIngress = helmAppFrontend.loadBalancer.ingress[0];
const helmAppIp = helmAppIngress.apply(x => x.ip ?? x.hostname)
export const helmAppUrl = pulumi.interpolate`http://${helmAppIp}`


// Create Codefresh K8s dashboard for the GKE cluster.
const auth = codefreshApiKey.apply(key => setAuth(key))
const codefreshDashboard = new CodefreshK8sDashboard('gke-cf-dash', {
    clusterName: k8sCluster.cluster.name
})
// Output the cluster name
export const fullClusterName = codefreshDashboard.fullClusterName

// Output the kubeconfig
export const kubeConfig = k8sCluster.kubeconfig
