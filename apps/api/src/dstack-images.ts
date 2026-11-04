/*
 * The confidential VMs NEAR AI runs its gateway and models in, as a TD measures them at boot: the
 * firmware (MRTD), the firmware's view of the machine (RTMR0), the kernel (RTMR1), and its command line
 * and initrd, which name the root filesystem's hash (RTMR2). A model report is used only if its quote's
 * measurements are exactly one of these (docs: notes-and-inference › What is checked).
 *
 * Source: the dstack OS images NEAR AI's reports name (their `os_image_hash` is each image's digest.txt),
 * published as release v0.5.12 of github.com/Dstack-TEE/meta-dstack (build commit 7f7b2762, reproducible
 * with its reproduce.sh): dstack-0.5.12.tar.gz (SHA-256 e3037d99…eb176) and dstack-nvidia-0.5.12.tar.gz
 * (SHA-256 b89d7875…086ee). The measurements were computed from those images with dstack-mr
 * (github.com/Dstack-TEE/dstack, commit d7e15dc9) for the machine each report's `vm_config` describes,
 * `dstack-mr measure --cpu … --memory … --qemu-version … --pci-hole64-size 0x4000000000000 --num-gpus …
 * --num-nvswitches … metadata.json`, and equal what NEAR AI's quotes carried on 3 November 2026.
 *
 * When NEAR AI moves to another image or machine, these stop matching and nothing is sent until the new
 * one is measured the same way and added here.
 */

export interface DstackImage {
  /** The image as dstack names it. */
  image: string;
  /** Its digest, as the `os-image-hash` event in RTMR3 and the report's vm_config give it. */
  osImageHash: string;
  /** The machine it was measured on, as NEAR AI's vm_config describes it. */
  machine: string;
  mrtd: string;
  rtmr0: string;
  rtmr1: string;
  rtmr2: string;
}

export const DSTACK_IMAGES: readonly DstackImage[] = [
  {
    image: 'dstack-nvidia-0.5.12', osImageHash: '91fd5d69ccee3e5ea4f2aeb8c9b632c4358c4ecfc29ba1aa6fb1e402af209829',
    machine: 'NEAR AI’s model VMs: 64 vCPUs, 2 TiB, 8 GPUs, 4 NVSwitches, QEMU 9.2.1',
    mrtd: 'df4d77c857de652bd0fafa343a2026b51071ee03773d076d283abf1a7d36ff91ffa279ee4a617ac664f7e2a2c8d5891b',
    rtmr0: 'bc122d143ab768565ba5c3774ff5f03a63c89a4df7c1f5ea38d3bd173409d14f8cbdcc36d40e703cccb996a9d9687590',
    rtmr1: '4ae609807c765916a31d724786ed74bcb97e168a9d937b04936aeef2015c907eba5ac352c6bcd749c246fd62ffb659ec',
    rtmr2: 'bd67ab7554dc27ab03a077bc1447a1a67d0624ff547c4c809a8626f12d6a89712f8ec60e781e99b98208574065d21a71'
  },
  {
    image: 'dstack-0.5.12', osImageHash: '8db40cb23008d6213668b5816702d100b37b859a8a5bfd18d938ae3a1b3715bd',
    machine: 'NEAR AI’s gateway VMs: 4 vCPUs, 8 GiB, no GPUs, QEMU 8.2.2',
    mrtd: '7fe60787222bd394cb516abca2435f22f035ab2cc9c0a4b4b3b148e46297f3d931a237b72f359052c6e657d8c1409173',
    rtmr0: 'd090162bff4b1d1dc74dc59dc548838efc4b811b173da8536efa8e2a9c045da70ee092301293ad90afebee448bcd0211',
    rtmr1: '4ae609807c765916a31d724786ed74bcb97e168a9d937b04936aeef2015c907eba5ac352c6bcd749c246fd62ffb659ec',
    rtmr2: '764489f277a8540189761e72b4238ba36d4d647e11bd958d8ab5522af2a4867b0ff63e06b0c4967f1857236244040a5d'
  }
];
