import type {Comparable} from 'bitumen/types';

export type Translation = Array<any> | boolean | null | number | string;

export default class Resource implements Comparable {
  definitions = new Map<string, string>();
  key: string;
  references = new Array<string>();
  translations = new Map<string, Translation>();

  constructor(name: string) {
    this.key = name;
  }

  compareTo(another: Resource) {
    return this.key.localeCompare(another.key);
  }

  equals(another: Resource) {
    return this.key == another.key;
  }
}
