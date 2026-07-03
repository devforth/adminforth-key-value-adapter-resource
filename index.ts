import type { KeyValueAdapter, IAdminForth } from "adminforth";
import { Filters, Sorts, afLogger } from 'adminforth';
import type { AdapterOptions } from "./types.js";

export default class ResourceKeyValueAdapter implements KeyValueAdapter {
  adminForth: IAdminForth | undefined;
  options: AdapterOptions;

  constructor(options: AdapterOptions) {
    this.options = options;
  }


  protected registerAdminForthIfNeeded() {
    if (!this.adminForth) {
      this.adminForth = global.adminforth as IAdminForth;
    }
  }

  protected getResource() {
    this.registerAdminForthIfNeeded();
    return this.adminForth!.resource(this.options.resourceId);
  }

  protected getActualKey(key: string, collection?: string): string {
    if (collection) {
      return `${collection}:${key}`;
    }
    return key;
  }

  protected getExpireAt(record: Record<string, any>): number | null {
    if (!this.options.expireField) {
      return null;
    }
    const raw = record[this.options.expireField];
    if (raw === null || raw === undefined || raw === '') {
      return null;
    }
    let ts: number;
    if (raw instanceof Date) {
      ts = raw.getTime();
    } else if (typeof raw === 'number') {
      ts = raw;
    } else {
      const asNumber = Number(raw);
      ts = Number.isNaN(asNumber) ? new Date(raw).getTime() : asNumber;
    }
    return Number.isNaN(ts) ? null : ts;
  }

  protected isExpired(record: Record<string, any>): boolean {
    const expireAt = this.getExpireAt(record);
    const expired = expireAt !== null && Date.now() > expireAt;
    return expired;
  }

  protected async cleanupExpired(actualPrefix: string): Promise<void> {
    if (!this.options.expireField) {
      return;
    }
    const resource = this.getResource();
    const expiredRecords = await resource.list(
      Filters.AND(
        Filters.LIKE(this.options.keyField, `${actualPrefix}%`),
        Filters.LT(this.options.expireField, Date.now()),
      ),
    );
    for (const record of expiredRecords) {
      await resource.delete(record[this.options.keyField]);
    }
  }

  async get(key: string, collection?: string): Promise<string | null> {
    const resource = this.getResource();
    const actualKey = this.getActualKey(key, collection);
    const record = await resource.get(Filters.EQ(this.options.keyField, actualKey));
    if (record) {
      if (this.isExpired(record)) {
        await resource.delete(actualKey);
        return null;
      }
      return record[this.options.valueField];
    } else {
      afLogger.error(`ResourceKeyValueAdapter: Key not found: ${actualKey} in collection: ${collection}`);
    }
  }

  async set(key: string, value: any, expiresInSeconds?: number, collection?: string): Promise<void> {
    const resource = this.getResource();
    if (expiresInSeconds && !this.options.expireField) {
      afLogger.error(`ResourceKeyValueAdapter: expiresInSeconds is set but no expireField is configured. Ignoring expiry for key: ${key} and collection: ${collection}`);
    }
    const actualKey = this.getActualKey(key, collection);
    const expireAt = expiresInSeconds ? Date.now() + expiresInSeconds * 1000 : null;

    const existing = await resource.get(Filters.EQ(this.options.keyField, actualKey));
    if (existing) {
      const updatePayload: Record<string, any> = {
        [this.options.valueField]: value,
      };
      if (this.options.expireField) {
        updatePayload[this.options.expireField] = expireAt;
      }
      await resource.update(actualKey, updatePayload);
    } else {
      const createPayload: Record<string, any> = {
        [this.options.keyField]: actualKey,
        [this.options.valueField]: value,
      };
      if (collection) {
        createPayload[this.options.collectionField] = collection;
      }
      if (this.options.expireField) {
        createPayload[this.options.expireField] = expireAt;
      }
      await resource.create(createPayload);
    }
  }

  async delete(key: string, collection?: string): Promise<void> {
    const resource = this.getResource();
    const actualKey = this.getActualKey(key, collection);
    await resource.delete(actualKey);
  }

  async listByPrefix(prefix: string, limit?: number, collection?: string): Promise<Record<string, string>[]> {
    const resource = this.getResource();
    const actualPrefix = this.getActualKey(prefix, collection);

    await this.cleanupExpired(actualPrefix);

    const list = await resource.list(Filters.LIKE(this.options.keyField, `${actualPrefix}%`), limit, 0, Sorts.ASC(this.options.keyField));

    const keyValuePairs: Record<string, string>[] = list.map((record) => {
      const key = record[this.options.keyField];
      const value = record[this.options.valueField];
      return { [key]: value };
    });

    const keyValuePairsFiltered = keyValuePairs.filter((pair) => {
      const key = Object.keys(pair)[0];
      if (collection) {
        return key.startsWith(`${collection}:`);
      }
      return true;     
    })

    keyValuePairsFiltered.forEach((pair) => {
      const key = Object.keys(pair)[0];
      if (collection) {
        const keyWithoutCollection = key.replace(`${collection}:`, '');
        pair[keyWithoutCollection] = pair[key];
        delete pair[key];
      }
    })

    const result = keyValuePairsFiltered.filter((pair) => {
      const key = Object.keys(pair)[0];
      if (key.startsWith(`${prefix}`)) {
        return true;
      }
      return false;
    })
    return result;
  }
}