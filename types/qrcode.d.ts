declare module 'qrcode' {
  export function toDataURL(data: string, options?: any): Promise<string>;
  export function toCanvas(canvas: any, data: string, options?: any): Promise<void>;
  const _default: {
    toDataURL: typeof toDataURL;
    toCanvas: typeof toCanvas;
  };
  export default _default;
}
