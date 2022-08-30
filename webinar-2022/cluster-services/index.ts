import * as aws from "@pulumi/aws";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { local } from "@pulumi/command";
import { StackTag } from "@pulumi/pulumiservice"

import { config } from "./config";
import { FluentdCloudWatch } from "./fluentd-cloudwatch";
import { ExternalDns } from "./external-dns";
import { AlbIngressController } from "./alb-ing-cntlr";

const project = pulumi.getProject();
const stack = pulumi.getStack();

const provider = new k8s.Provider("provider", {kubeconfig: config.kubeconfig});

// Deploy fluentd-cloudwatch.
const fluentd = new FluentdCloudWatch("fluentd-cloudwatch", {
    provider: provider,
    namespace: config.clusterSvcsNamespaceName,
    clusterOidcProviderArn: config.clusterOidcProviderArn,
    clusterOidcProviderUrl: config.clusterOidcProviderUrl,
});
export const fluentdCloudWatchLogGroupName = fluentd.logGroupName;

// Deploy external-dns.
const extDns = new ExternalDns("external-dns", {
    provider: provider,
    namespace: config.clusterSvcsNamespaceName,
    commandArgs: [
        "--source=ingress",
        "--domain-filter=" + config.hostedZoneDomainName, // will make ExternalDNS see only the hosted zones matching provided domain, omit to process all available hosted zones
        "--provider=aws",
        "--policy=sync",
        "--registry=txt",
        config.clusterName.apply(name => `--txt-owner-id=${name}`)
    ],
    clusterOidcProviderArn: config.clusterOidcProviderArn,
    clusterOidcProviderUrl: config.clusterOidcProviderUrl,
});

// Deploy ALB Ingress Controller.
const albIngCntlr = new AlbIngressController("alb-ing-cntlr", {
    namespace: "kube-system",
    provider: provider,
    vpcId: config.vpcId, 
    clusterName: config.clusterName,
    clusterOidcProviderArn: config.clusterOidcProviderArn,
    clusterOidcProviderUrl: config.clusterOidcProviderUrl,
});

// --- Register Cluster with Codefresh ---
if (config.codefreshApiKey) {
    const cfRegistration = new local.Command(`codefresh-cmd`, {
        dir: "../commands",
        interpreter: [ "/bin/sh" ],
        create: "codefresh_register",
        delete: "codefresh_deregister",
        environment: {
            CODEFRESH_API_KEY: config.codefreshApiKey,
            CLUSTER_KUBECONFIG_STRING: config.kubeconfig.apply(kubeconfig => JSON.stringify(kubeconfig))
        }
    })
}

// --- Pulumi Service Stack Tag ---
const stackTag = new StackTag(`stacktag`, {
    name: "Codefresh",
    value: "Webinar",
    organization: config.org,
    project: project,
    stack: stack,
});


// Create the wildcard TLS cert in ACM to use with the ALB on both the API and
// the console.
const certCertificate = new aws.acm.Certificate("cert", {
    domainName: `*.${config.hostedZoneDomainSubdomain}.${config.hostedZoneDomainName}`,
    subjectAlternativeNames: [`${config.hostedZoneDomainSubdomain}.${config.hostedZoneDomainName}`],
    validationMethod: "DNS",
});
const zone = pulumi.output(aws.route53.getZone({
    name: `${config.hostedZoneDomainName}.`,
    privateZone: false,
}));
const certValidation = new aws.route53.Record("certValidation", {
    name: certCertificate.domainValidationOptions[0].resourceRecordName,
    records: [certCertificate.domainValidationOptions[0].resourceRecordValue],
    ttl: 60,
    type: certCertificate.domainValidationOptions[0].resourceRecordType,
    zoneId: zone.id,
});
const certCertificateValidation = new aws.acm.CertificateValidation("cert", {
    certificateArn: certCertificate.arn,
    validationRecordFqdns: [certValidation.fqdn],
});

export const validationCertArn = certCertificateValidation.certificateArn
export const albSecurityGroupId = config.albSecurityGroupId
