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

  async get(key: string, collection?: string): Promise<string> {
    const resource = this.getResource();
    const actualKey = this.getActualKey(key, collection);
    const record = await resource.get(Filters.EQ(this.options.keyField, actualKey));
    if (record) {
      return record[this.options.valueField];
    } else {
      console.error(`ResourceKeyValueAdapter: Key not found: ${actualKey} in collection: ${collection}`);
    }
  }

  async set(key: string, value: any, expiresInSeconds?: number, collection?: string): Promise<void> {
    const resource = this.getResource();
    if (expiresInSeconds) {
      afLogger.error(`ResourceKeyValueAdapter does not support expiresInSeconds yet. Ignoring expiresInSeconds for key: ${key} and collection: ${collection}`);
    }
    const actualKey = this.getActualKey(key, collection);
    if (collection) {
      const existing = await resource.get(Filters.AND(Filters.EQ(this.options.collectionField, collection), Filters.EQ(this.options.keyField, actualKey)));
      if (existing) {
        await resource.update(Filters.AND(Filters.EQ(this.options.collectionField, collection), Filters.EQ(this.options.keyField, actualKey)), {
          [this.options.valueField]: value,
        });
      } else {
        await resource.create({
          [this.options.keyField]: actualKey,
          [this.options.valueField]: value,
          [this.options.collectionField]: collection,
        });
      }
    } else {
      const existing = await resource.get(Filters.EQ(this.options.keyField, actualKey));
      if (existing) {
        await resource.update(Filters.EQ(this.options.keyField, actualKey), {
          [this.options.valueField]: value,
        });
      } else {
        await resource.create({
          [this.options.keyField]: actualKey,
          [this.options.valueField]: value,
        });
      }
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
    const list = await resource.list(Filters.LIKE(this.options.keyField, `${actualPrefix}%`), limit, 0, Sorts.ASC(this.options.keyField));

    const keyValuePairs: Record<string, string>[] = list.map((record) => {
      const key = record[this.options.keyField];
      const value = record[this.options.valueField];
      return { [key]: value };
    });

    return keyValuePairs;
  }
}