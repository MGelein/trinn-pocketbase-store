import PocketBase, { RecordListOptions, type RecordModel } from "pocketbase";
import { writable, type Writable } from "svelte/store";

const ERROR_CREATE_PB =
  "Something went wrong during instantiation of the Pocketbase instance. Do you have the correct url?";
const ERROR_AUTH =
  "Something went wrong during login of pocketbase. Please check your credentials";
const ERROR_INIT =
  "Please initialize the library first using PBWritable.init before using any method";
const ERROR_SUBSCRIPTION =
  "Something went wrong during unsubscription of pocketbase collection. How did you manage this?!";
const ERROR_UPDATE = "Something went wrong trying to update a record.";
const ERROR_CREATE = "Something went wrong trying to create a record.";
const ERROR_REMOVE = "Something went wrong trying to remove a record.";

const NO_UPDATE = async () => true;
const NO_REMOVE = NO_UPDATE;
const NO_CREATE = async () => "";

export type ListTransform<T extends any[]> = (r: RecordModel) => T[number];
export type Transform<T> = (r: RecordModel) => T;
export type SingleReturnType<T> = [
  Writable<T>,
  (changes: Record<string, any>) => Promise<boolean>
];
export type ListReturnType<T> = [
  Writable<T>,
  (id: string, changes: Record<string, any>) => Promise<boolean>,
  (item: T) => Promise<string>,
  (id: string) => Promise<Boolean>
];

function castList<T extends any[]>(
  items: RecordModel[],
  transform?: ListTransform<T>
) {
  return transform ? (items.map(transform) as T) : (items as T);
}

function cast<T>(item: RecordModel, transform?: Transform<T>) {
  return transform ? transform(item) : (item as T);
}

abstract class PBWritable {
  static baseUrl: string | null = null;
  private static pb: PocketBase | null = null;

  /**
   * The constructor is not used. This class is not meant to be used.
   */
  private constructor() {}

  /**
   * Connects to the global instance of pocketbase we want to use. Currently we only support one instance
   * @param pocketBaseUrl the location of your pocketbase instance
   * @param username (optional) if provided, will try to login using this username
   * @param password (optional) if provided, will try to login using this password
   * @returns returns if pocketbase was  correctly created. If credentials are provided, it also returns if login was succesful
   */
  static connect(pocketBaseUrl: string) {
    this.baseUrl = pocketBaseUrl;

    try {
      this.pb = new PocketBase(pocketBaseUrl);
    } catch {
      console.error(ERROR_CREATE_PB);
      return false;
    }

    return true;
  }

  static async login(username: string, password: string) {
    try {
      if (!this.pb) throw new Error(ERROR_INIT);
      this.pb.collection("users").authWithPassword(username, password);

      return this.pb.authStore.isValid;
    } catch {
      console.error(ERROR_AUTH);
      return false;
    }
  }

  static async disconnect(collectionName: string, id: string = "*") {
    if (!this.pb) {
      console.error(ERROR_SUBSCRIPTION);
      return false;
    }
    try {
      await this.pb.collection(collectionName).unsubscribe(id);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Creates a simple writable Svelte store for a single Pocketbase entry.
   * @param collectionName the name of the pocketbase colleciton
   * @param id the id of the pocketbase record to subscribe to
   * @param transform (optional) transform that is called everytime a new element is set in the store
   * @returns [Svelte store, update method]
   */
  static create<T>(
    collectionName: string,
    id: string,
    transform?: Transform<T>
  ) {
    if (!this.pb) {
      console.error(ERROR_INIT);
      return [writable<T>(), NO_UPDATE] as SingleReturnType<T>;
    }
    const collection = this.pb.collection(collectionName);

    const update = async (changes: Record<string, any>) => {
      try {
        await collection.update(id, changes);
        return true;
      } catch {
        console.error(ERROR_UPDATE);
        return false;
      }
    };
    collection.getOne(id).then((record) => {
      if (record) {
        store.set(cast<T>(record, transform));
      }
    });
    const defaultValue: RecordModel = {} as RecordModel;
    const store = writable<T>(cast<T>(defaultValue, transform));

    collection.unsubscribe(id);
    collection.subscribe(id, async () => {
      const newRecord = await collection.getOne(id);
      if (newRecord) {
        store.set(cast<T>(newRecord, transform));
      }
    });

    return [store, update] as SingleReturnType<T>;
  }

  /**
   * Creates a simple writable Svelte store for a complete Pocketbase collection.
   * By default the whole collection is reset everytime anything changes in the database
   * @param collectionName the name of the pocketbase collection
   * @param options a combination of the normal RecordListOptions but it includes page and perPage variables as well
   * @param transform (optional) transform that is called everytime a new element is set in the store
   * @returns [Svelte store, update method, create method, remove method]
   */
  static createList<T extends any[]>(
    collectionName: string,
    options?: RecordListOptions & { page?: number; perPage?: number },
    transform?: ListTransform<T>
  ) {
    if (!this.pb) {
      console.error(ERROR_INIT);
      return [
        writable<T>(),
        NO_UPDATE,
        NO_CREATE,
        NO_REMOVE,
      ] as ListReturnType<T>;
    }
    const collection = this.pb.collection(collectionName);

    const update = async (id: string, changes: Record<string, any>) => {
      try {
        await collection.update(id, changes);
        return true;
      } catch {
        console.error(ERROR_UPDATE);
        return false;
      }
    };

    const remove = async (id: string) => {
      try {
        return await collection.delete(id);
      } catch {
        console.error(ERROR_REMOVE);
        return false;
      }
    };

    const create = async (item: T[number]) => {
      try {
        const record = await collection.create(item);
        return record?.id ?? null;
      } catch {
        console.error(ERROR_CREATE);
        return null;
      }
    };

    const page = options?.page ?? -1;
    const perPage = options?.perPage ?? -1;
    const getAll = page === -1 || perPage === -1;

    if (getAll) {
      collection.getFullList(options).then((value) => {
        store.set(value as T);
      });
    } else {
      collection.getList(page, perPage, options).then((value) => {
        store.set(value.items as T);
      });
    }
    const store = writable<T>(castList<T>([], transform));

    collection.unsubscribe("*");
    collection.subscribe("*", async () => {
      const list = getAll
        ? await collection.getFullList(options)
        : (await collection.getList(page, perPage, options)).items;
      store.set(castList<T>(list, transform));
    });

    return [store, update, create, remove] as ListReturnType<T>;
  }
}

export default PBWritable;
