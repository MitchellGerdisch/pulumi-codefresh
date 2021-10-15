import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";
import * as random from "@pulumi/random";
import * as pulumi from "@pulumi/pulumi";
import { Input, Output } from "@pulumi/pulumi";

export interface K8sClusterArgs {
  projectName: string;
}

export class K8sCluster extends pulumi.ComponentResource {
  public readonly bucketName: Output<string>;
  public readonly provider: k8s.Provider;
  public readonly cluster: gcp.container.Cluster;
  public readonly kubeconfig: Output<string>;

  constructor(name: string, args: K8sClusterArgs, opts?: pulumi.ComponentResourceOptions) {
    super("custom:x:GkeCluster", name, args, opts)

    const projectName = args.projectName;
    const bucketName = `${projectName}-bucket`
    const username = "gcloud-admin";
    const pwdName = `${projectName}-pwd`
    const clusterName = `${projectName}-k8s`
    const lastestMasterVersion = gcp.container.getEngineVersions();

    const password = new random.RandomPassword(pwdName, { length: 16 }, {parent: this}).result;
    const gkeBucket = new gcp.storage.Bucket(bucketName, {}, {parent: this});
    
    const gkeCluster = new gcp.container.Cluster(clusterName, {
      initialNodeCount: 1,
      nodeVersion: lastestMasterVersion.then(it => it.latestNodeVersion),
      minMasterVersion: lastestMasterVersion.then(it => it.latestMasterVersion),
      masterAuth: { username, password },
      nodeConfig: {
        machineType: "n1-standard-1",
        oauthScopes: [
          "https://www.googleapis.com/auth/compute",
          "https://www.googleapis.com/auth/devstorage.read_only",
          "https://www.googleapis.com/auth/logging.write",
          "https://www.googleapis.com/auth/monitoring",
        ],
      },
      resourceLabels: {
          "cost-center": projectName,
      },
    }, {parent: this});
    
    // Manufacture a GKE-style Kubeconfig. Note that this is slightly "different" because of the way GKE requires
    // gcloud to be in the picture for cluster authentication (rather than using the client cert/key directly).
    const gkeKubeconfig = pulumi.
      all([gkeCluster.name, gkeCluster.endpoint, gkeCluster.masterAuth]).
      apply(([name, endpoint, auth]) => {
        const context = `${gcp.config.project}_${gcp.config.zone}_${name}`;
        return `apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: ${auth.clusterCaCertificate}
    server: https://${endpoint}
  name: ${context}
contexts:
- context:
    cluster: ${context}
    user: ${context}
  name: ${context}
current-context: ${context}
kind: Config
preferences: {}
users:
- name: ${context}
  user:
    auth-provider:
      config:
        cmd-args: config config-helper --format=json
        cmd-path: gcloud
        expiry-key: '{.credential.token_expiry}'
        token-key: '{.credential.access_token}'
      name: gcp
`;
      });

    const gkeProvider = new k8s.Provider(projectName, {
      kubeconfig: gkeKubeconfig,
    }, { parent: gkeCluster });

    this.registerOutputs({});
    this.bucketName = gkeBucket.name;
    this.provider = gkeProvider;
    this.cluster = gkeCluster;
    // return the kubeconfig as a secret
    this.kubeconfig = pulumi.secret(gkeKubeconfig);
  }
}
