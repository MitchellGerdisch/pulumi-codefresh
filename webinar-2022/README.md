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