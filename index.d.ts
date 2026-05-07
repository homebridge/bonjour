import { RemoteInfo, Socket } from "dgram";

/**
 * Options accepted by the underlying multicast-dns responder.
 * Forwarded by `Bonjour(options)` straight into `multicast-dns`.
 */
export interface MulticastOptions {
  /** Multicast port. Defaults to 5353. */
  port?: number;
  /** Socket type. Defaults to 'udp4'. */
  type?: "udp4" | "udp6";
  /** Multicast IP address. Defaults to 224.0.0.251 for udp4. Required for udp6. */
  ip?: string;
  /** Alias for `ip`. */
  host?: string;
  /** Interface name. Required for IPv6 multicast. */
  interface?: string;
  /** Whether to allow address reuse. Defaults to true. */
  reuseAddr?: boolean;
  /** Pre-created dgram socket. */
  socket?: Socket;
  /** Whether to join the multicast group. Defaults to true. */
  multicast?: boolean;
  /** Multicast TTL. Defaults to 255. */
  ttl?: number;
  /** Multicast loopback. Defaults to true. */
  loopback?: boolean;
  /** Bind address, or `false` to skip binding. */
  bind?: string | false;
}

export interface BonjourFindOptions {
  /** If omitted, performs a wildcard search across all service types. */
  type?: string;
  /** Defaults to 'tcp'. */
  protocol?: "tcp" | "udp";
  /** Filter to a specific service instance name. */
  name?: string;
  /** Options forwarded to the TXT record decoder. */
  txt?: { binary?: boolean };
}

/**
 * A service discovered via {@link Bonjour.find} / {@link Bonjour.findOne}.
 *
 * Populated from incoming SRV/TXT/A/AAAA records. Services without a matching
 * SRV record are filtered out before being emitted, so all SRV-derived fields
 * are guaranteed to be present on emitted services.
 */
export interface BonjourService {
  name: string;
  fqdn: string;
  type: string;
  subtypes: string[];
  protocol: "tcp" | "udp";
  host: string;
  port: number;
  referer: RemoteInfo;
  addresses: string[];
  /** Decoded TXT record, if a TXT record was received. */
  txt?: Record<string, string>;
  /** Raw TXT record blocks, if a TXT record was received. */
  rawTxt?: Buffer[];
}

export interface Browser {
  /** Currently-known services. Updated as services come up, change, or go down. */
  services: BonjourService[];

  start(): void;
  stop(): void;
  /** Send a fresh PTR query to refresh the service list. */
  update(): void;

  on(event: "up" | "down" | "update", listener: (service: BonjourService) => void): this;
}

/**
 * A service published via {@link Bonjour.publish}. Returned to the caller so
 * they can update the TXT record, stop, or destroy the advertisement.
 */
export interface Advertisement {
  name: string;
  type: string;
  protocol: "tcp" | "udp";
  host: string;
  port: number;
  fqdn: string;
  subtypes: string[] | null;
  txt: Record<string, string> | null;
  /** True once the initial announcement has been confirmed. */
  published: boolean;

  start(): void;
  /**
   * Stop advertising. The callback is required if the service has not been
   * activated yet (the runtime calls it synchronously in that case).
   */
  stop(callback?: () => void): void;
  /** Tear down the service and remove all listeners. */
  destroy(): void;
  /** Replace the TXT record. If `silent` is true, the new record is registered but not re-announced. */
  updateTxt(txt: Record<string, string>, silent?: boolean): void;

  /** Emitted once after the first successful announcement. */
  on(event: "up", listener: () => void): this;
  /** Emitted if the service name is already in use on the network. */
  on(event: "error", listener: (err: Error) => void): this;
}

export interface PublishOptions {
  name: string;
  type: string;
  port: number;
  host?: string;
  protocol?: "tcp" | "udp";
  subtypes?: string[];
  txt?: Record<string, string>;
  /** Probe for name conflicts before announcing. Defaults to true. */
  probe?: boolean;

  /**
   * Adds a meta enumeration record (`_services._dns-sd._udp.local`) when announcing.
   * Only safe to enable when a single service is advertised on the responder, otherwise
   * removing one service will break enumeration for the others.
   */
  addUnsafeServiceEnumerationRecord?: boolean;

  /**
   * Restricts the service to be advertised on the specified IP addresses or interface names.
   * Interface names and addresses can be mixed.
   * If an interface name is given, ANY address on that interface is advertised.
   * If an IP address is given, only that address is advertised.
   */
  restrictedAddresses?: string[];

  /** If true, the service will not advertise IPv6 (AAAA) records. */
  disabledIpv6?: boolean;
}

export interface Bonjour {
  publish(options: PublishOptions): Advertisement;
  unpublishAll(callback?: () => void): void;
  find(
    options: BonjourFindOptions,
    onUp?: (service: BonjourService) => void
  ): Browser;
  findOne(
    options: BonjourFindOptions,
    callback?: (service: BonjourService) => void
  ): Browser;
  /**
   * Tear down the responder. Goodbye records are broadcast for every
   * published service before the underlying mdns socket is closed.
   * The optional callback fires once teardown is complete.
   */
  destroy(callback?: () => void): void;
  /**
   * Emitted when the underlying mdns socket reports an error or an
   * outgoing response fails. If no listener is attached, the error is
   * logged to `console.warn` so it does not crash the process.
   */
  on(event: "error", listener: (err: Error) => void): this;
}

export interface BonjourFactory {
  new (options?: MulticastOptions): Bonjour;
  (options?: MulticastOptions): Bonjour;
}

declare const Bonjour: BonjourFactory;
export default Bonjour;
