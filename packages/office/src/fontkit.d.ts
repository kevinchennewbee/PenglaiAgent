declare module "@pdf-lib/fontkit" {
  const fontkit: {
    create: (buffer: Uint8Array) => unknown;
    registerFormat: (format: unknown) => void;
  };
  export default fontkit;
}
