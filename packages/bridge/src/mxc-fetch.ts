import { Intent } from "matrix-appservice-bridge";

export async function fetchMXC(intent: Intent, url: string): Promise<Uint8Array>{
    const data  = await intent.matrixClient.downloadContent(url, true);
    const buf = data.data;
    return new Uint8Array(buf);
} 