/*
 * The two roots private inference is checked against (docs: notes-and-inference › Verified private
 * inference). They're the defaults of INTEL_ROOT_CA and NVIDIA_ROOT_CA; tests set their own, and run the
 * same checks.
 */

/**
 * Intel SGX Root CA, which every TDX quote's signature chain ends at (through the PCK certificates) and
 * which signs Intel's TCB collateral. SHA-256 fingerprint
 * 44:A0:19:6B:2B:99:F8:89:B8:E1:49:E9:5B:80:7A:35:0E:74:24:96:43:99:E8:85:A7:CB:B8:CC:FA:B6:74:D3, as Intel
 * publishes it at https://certificates.trustedservices.intel.com/Intel_SGX_Provisioning_Certification_RootCA.pem.
 */
export const INTEL_SGX_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIICjzCCAjSgAwIBAgIUImUM1lqdNInzg7SVUr9QGzknBqwwCgYIKoZIzj0EAwIw
aDEaMBgGA1UEAwwRSW50ZWwgU0dYIFJvb3QgQ0ExGjAYBgNVBAoMEUludGVsIENv
cnBvcmF0aW9uMRQwEgYDVQQHDAtTYW50YSBDbGFyYTELMAkGA1UECAwCQ0ExCzAJ
BgNVBAYTAlVTMB4XDTE4MDUyMTEwNDUxMFoXDTQ5MTIzMTIzNTk1OVowaDEaMBgG
A1UEAwwRSW50ZWwgU0dYIFJvb3QgQ0ExGjAYBgNVBAoMEUludGVsIENvcnBvcmF0
aW9uMRQwEgYDVQQHDAtTYW50YSBDbGFyYTELMAkGA1UECAwCQ0ExCzAJBgNVBAYT
AlVTMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEC6nEwMDIYZOj/iPWsCzaEKi7
1OiOSLRFhWGjbnBVJfVnkY4u3IjkDYYL0MxO4mqsyYjlBalTVYxFP2sJBK5zlKOB
uzCBuDAfBgNVHSMEGDAWgBQiZQzWWp00ifODtJVSv1AbOScGrDBSBgNVHR8ESzBJ
MEegRaBDhkFodHRwczovL2NlcnRpZmljYXRlcy50cnVzdGVkc2VydmljZXMuaW50
ZWwuY29tL0ludGVsU0dYUm9vdENBLmRlcjAdBgNVHQ4EFgQUImUM1lqdNInzg7SV
Ur9QGzknBqwwDgYDVR0PAQH/BAQDAgEGMBIGA1UdEwEB/wQIMAYBAf8CAQEwCgYI
KoZIzj0EAwIDSQAwRgIhAOW/5QkR+S9CiSDcNoowLuPRLsWGf/Yi7GSX94BgwTwg
AiEA4J0lrHoMs+Xo5o/sX6O9QWxHRAvZUGOdRQ7cvqRXaqI=
-----END CERTIFICATE-----
`;

/**
 * NVIDIA Attestation Service CA 001, which the keys NVIDIA's Remote Attestation Service (NRAS) signs GPU
 * verdicts with chain to, through its GPU intermediates. SHA-256 fingerprint
 * CD:E2:69:E3:F7:2C:66:7A:EC:C2:D8:C1:AB:32:C4:E4:2A:AF:55:07:37:9F:15:F2:21:C7:7C:55:18:10:1A:1E, the root of
 * the chain NVIDIA publishes at https://prod.vault.nvidia.com/v1/dgxc-attestation/pki/nras-prod/ca_chain.
 */
export const NVIDIA_NRAS_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIICUDCCAdagAwIBAgIUF11XI0bGzc7WYhmjf6qrdvR1ntYwCgYIKoZIzj0EAwMw
VjELMAkGA1UEBhMCVVMxGzAZBgNVBAoMEk5WSURJQSBDb3Jwb3JhdGlvbjEqMCgG
A1UEAwwhTlZJRElBIEF0dGVzdGF0aW9uIFNlcnZpY2UgQ0EgMDAxMCAXDTI1MTIx
MDAwMTg1MVoYDzIwNTUxMjAzMDAxODUxWjBWMQswCQYDVQQGEwJVUzEbMBkGA1UE
CgwSTlZJRElBIENvcnBvcmF0aW9uMSowKAYDVQQDDCFOVklESUEgQXR0ZXN0YXRp
b24gU2VydmljZSBDQSAwMDEwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAASQz1nh45YS
HgbSQtZ99x0Y+i+l4HkK7sEA48ZmaW3BoI4yndSr2B7+O80zJpDuB567TqbJZYkS
kBpYV0huK6v4oJ3K8jCG+j6mTEBwW/NxUJCo+3zQQYPvdr9HV9a039mjYzBhMA8G
A1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBS+Cm/tecJI
qoo3Cyb2hTcxbHIEvzAfBgNVHSMEGDAWgBS+Cm/tecJIqoo3Cyb2hTcxbHIEvzAK
BggqhkjOPQQDAwNoADBlAjA7uesOrKwGhWEkZhSnXEVaMVIDbXe+ThfWz02dXBCD
jytfIMcvpjnhrLK+jN1+YZsCMQCU+1mar0sQ7kFvSsvSGbGgEBv8DQNuNFhF8MS3
L2EYuOBzIY0rUStYQago+aIYpyY=
-----END CERTIFICATE-----
`;
