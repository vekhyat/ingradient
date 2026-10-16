// js-yaml 4 ships JavaScript only. @types/js-yaml would be a package change,
// and this task cannot edit package.json.
declare module 'js-yaml' {
  export function load(source: string): unknown;
}
