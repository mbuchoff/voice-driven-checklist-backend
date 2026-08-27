import { convertFiles } from '@cdktf/hcl2json';

type ParsedResourceBlocks = Record<
  string,
  Record<string, Array<{ lifecycle?: Array<{ destroy?: unknown }> }>>
>;

interface ParsedConfiguration {
  readonly resource?: ParsedResourceBlocks;
}

export async function findLifecycleGuardViolations(
  configurationDirectory: string,
  protectedBlockAddresses: readonly string[],
): Promise<string[]> {
  const configuration = (await convertFiles(
    configurationDirectory,
  )) as ParsedConfiguration;

  return protectedBlockAddresses.flatMap((address) => {
    const [resourceType, resourceName, ...unexpected] = address.split('.');
    if (resourceType === undefined || resourceName === undefined || unexpected.length > 0) {
      return [`${address}: protected lifecycle address must identify one resource block`];
    }

    const blocks = configuration.resource?.[resourceType]?.[resourceName];
    const isProtected =
      blocks?.length === 1 &&
      blocks[0]?.lifecycle?.length === 1 &&
      blocks[0].lifecycle[0]?.destroy === false;

    return isProtected
      ? []
      : [`${address}: resource block must declare lifecycle { destroy = false }`];
  });
}
