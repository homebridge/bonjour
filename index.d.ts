import { SocketOptions } from "dgram";

export type BonjourFindOptions = {
  type: string;
  subtypes?: string[];
  protocol?: "tcp" | "udp";
  txt?: Record<string, any>;
};

export interface BonjourService {
  name: string;
  type: string;
  protocol: "tcp" | "udp";
  host: string;
  port: number;
  addresses: string[];
  txt: Record<string, string>;
  rawTxt?: Buffer;
}

export interface MulticastOptions extends SocketOptions {
  multicastAddress?: string;
  multicastInterface?: string;
  multicastTTL?: number;
  reuseAddr?: boolean;
}

export class Browser {
  start(): void;
  stop(): void;
  update(): void;
  on(event: "up" | "down", listener: (service: BonjourService) => void): this;
}

export class Advertisement {
  stop(): void;
  start(): void;
  update(txt: Record<string, string>): void;
  on(event: "error", listener: (err: Error) => void): this;
}

export interface PublishOptions {
  name: string;
  type: string;
  subtypes?: string[];
  port: number;
  host?: string;
  txt?: Record<string, string>;
  protocol?: "tcp" | "udp";
}

export default class Bonjour {
  constructor(options?: MulticastOptions);

  publish(options: PublishOptions): Advertisement;
  unpublishAll(callback?: () => void): void;
  find(
    options: BonjourFindOptions,
    onUp?: (service: BonjourService) => void
  ): Browser;
  findOne(
    options: BonjourFindOptions,
    callback: (service: BonjourService) => void
  ): Browser;
  destroy(): void;
}
