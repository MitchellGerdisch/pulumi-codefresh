import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export const zoneName = "pulumi-ce.team";
export const subdomainName = "codefresh";
export const domainName = `${subdomainName}.${zoneName}`;

// Create the wildcard TLS cert in ACM to use with the ALB 
const certCertificate = new aws.acm.Certificate("cert", {
  domainName: `*.${domainName}`,
  subjectAlternativeNames: [domainName],
  validationMethod: "DNS",
});
const zone = pulumi.output(aws.route53.getZone({
  name: zoneName, 
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

