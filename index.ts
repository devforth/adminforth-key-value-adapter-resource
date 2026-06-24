import type { KeyValueAdapter, IAdminForth } from "adminforth";
import { Filters, Sorts } from 'adminforth';
import type { AdapterOptions } from "./types.js";

export default class RAMKeyValueAdapter implements KeyValueAdapter {
  adminForth: IAdminForth | undefined;
  options: AdapterOptions;

  constructor(options: AdapterOptions) {
    this.options = options;
  }


  protected registerAdminForthIfNeeded() {
    if (!this.adminForth) {
      this.adminForth = global.adminForth as IAdminForth;
    }
  }

  protected getResource() {
    this.registerAdminForthIfNeeded();
    return this.adminForth!.resource(this.options.resourceId);
  }

  async get(key: string, collection?: string): Promise<string> {
    const resource = this.getResource();
    if (collection) {
      return await resource.get(Filters.AND(Filters.EQ(this.options.collectionField, collection), Filters.EQ(this.options.keyField, key)));
    } else {
      return await resource.get(Filters.EQ(this.options.keyField, key));
    }
  }

  async set(key: string, value: any, expiresInSeconds?: number, collection?: string): Promise<void> {
    const resource = this.getResource();
    if (collection) {
      const existing = await resource.get(Filters.AND(Filters.EQ(this.options.collectionField, collection), Filters.EQ(this.options.keyField, key)));
      if (existing) {
        await resource.update(Filters.AND(Filters.EQ(this.options.collectionField, collection), Filters.EQ(this.options.keyField, key)), {
          [this.options.valueField]: value,
        });
      } else {
        await resource.create({
          [this.options.keyField]: key,
          [this.options.valueField]: value,
          [this.options.collectionField]: collection,
        });
      }
    } else {
      const existing = await resource.get(Filters.EQ(this.options.keyField, key));
      if (existing) {
        await resource.update(Filters.EQ(this.options.keyField, key), {
          [this.options.valueField]: value,
        });
      } else {
        await resource.create({
          [this.options.keyField]: key,
          [this.options.valueField]: value,
        });
      }
    }
  }

  async delete(key: string, collection?: string): Promise<void> {
    const resource = this.getResource();
    if (collection) {
      this.adminForth!.resource(this.options.resourceId).delete(Filters.AND(Filters.EQ(this.options.collectionField, collection), Filters.EQ(this.options.keyField, key)));
    } else {
      this.adminForth!.resource(this.options.resourceId).delete(Filters.EQ(this.options.keyField, key));
    }
  }

  async listByPrefix(prefix: string, limit?: number, collection?: string): Promise<Record<string, string>[]> {
    const resource = this.getResource();
    if (collection) {
      return await resource.list(Filters.AND(Filters.EQ(this.options.collectionField, collection), Filters.LIKE(this.options.keyField, `${prefix}%`)), limit, 0, Sorts.ASC(this.options.keyField));
    } else {
      return await resource.list(Filters.LIKE(this.options.keyField, `${prefix}%`), limit, 0, Sorts.ASC(this.options.keyField));
    }
  }
}