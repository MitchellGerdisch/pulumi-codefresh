import * as aws from "@pulumi/aws";
import { config } from "./config";


// --- Identity ---

// The managed policies EKS required of nodegroups join a cluster.
const nodegroupManagedPolicyArns: string[] = [
  "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
  "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
  "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
];

// Create the standard node group worker role and attach the required policies.
const ngName = "standardNodeGroup";
const pulumiNgName = "pulumiStandardNodeGroup";
export const nodegroupIamRole = new aws.iam.Role(`${ngName}-eksClusterWorkerNode`, {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({"Service": "ec2.amazonaws.com"}),
  tags: config.tags,
})
attachPoliciesToRole(ngName, nodegroupIamRole, nodegroupManagedPolicyArns);

// Create the pulumi standard node group worker role and attach the required policies.
export const pulumiNodegroupIamRole = new aws.iam.Role(`${pulumiNgName}-eksClusterWorkerNode`, {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({"Service": "ec2.amazonaws.com"}),
  tags: config.tags,
})
attachPoliciesToRole(pulumiNgName, pulumiNodegroupIamRole, nodegroupManagedPolicyArns);
export const pulumiNodegroupIamRoleArn = nodegroupIamRole.arn;

// Attach policies to a role.
function attachPoliciesToRole(name: string, role: aws.iam.Role, policyArns: string[]) {
  for (const policyArn of policyArns) {
      new aws.iam.RolePolicyAttachment(`${name}-${policyArn.split('/')[1]}`,
          { policyArn: policyArn, role: role },
      );
  }
}
