# Webinar 2022 - GitOps with Pulumi and Codefresh
Date: August 30, 2022  
Presenters:
* Mitch Gerdisch (Pulumi)
* Christian Hernandez (Codefresh)

# Overview of Demo/Webinar
* Introductory slides
* Pulumi used to 
  * deploy a K8s cluster and other resources (e.g. RDS)
  * Command provider used to connect the cluster to Codefresh
  * Leverages:
    * config secrets (codefresh api token)
    * output secrets (kubeconfig)
    * Pulumi Service - visibility and management
* Codefresh used to manage the deployments to K8s

# Prerequisites
* Install Codefresh CLI.
  * The Codefresh UI will provide an installer otherwise, see: https://codefresh-io.github.io/cli/installation/

# Set Up
* (DONE ONCE) Configure context for accessing Codefresh Service 
  * In UI click on `Connect a K8s Cluster` generate an API key and run the provided command:  
    `cf config create-context codefresh --api-key  APIKEY`
* Set up kubeconfig
  * Set up $KUBECONFIG
    * `pulumi stack output kubeconfig --show-secrets > /tmp/kubeconfig.txt`
    * `export KUBECONFIG=/tmp/kubeconfig.txt`
  * AKS: Set up local context: 
    * `az aks get-credentials --name CLUSTER_NAME --resource-group RESOURCE_GROUP_NAME`
* Connect to Codefresh Service
  * `cf cluster add codefresh-hosted`