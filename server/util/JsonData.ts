type ArrayOrNot<T> = T | T[];

export type JsonData =
  | ArrayOrNot<null | undefined | string | number | boolean | Date | { [key: string]: JsonData }>
  | JsonData[];
