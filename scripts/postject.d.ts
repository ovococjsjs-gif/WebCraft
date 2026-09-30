declare module 'postject' {
  export function inject(
    filename: string,
    resourceName: string,
    resourceData: Uint8Array,
    options?: { sentinelFuse?: string; machoSegmentName?: string; overwrite?: boolean },
  ): Promise<void>;
}
