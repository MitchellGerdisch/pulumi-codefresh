import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
export const codefreshApiKey = config.requireSecret("codefreshApiKey")

export const projectName = pulumi.getProject();
export const stackName = pulumi.getStack();
