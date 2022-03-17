import { parse, print } from "graphql/language";

export const wsScheme = (url: string) => {
  const parts = url.split("//");
  return (parts[0].includes("https") ? "wss" : "ws") + "://" + parts[1];
};

export const cloneObject = (obj: Record<string, any>) => {
  if (!obj || (obj && obj.constructor.name !== "Object")) {
    return obj;
  }
  return JSON.parse(JSON.stringify(obj));
};

export const getOperationFromQueryFileContent = (
  fileContent: any,
  operationName: any
) => {
  try {
    const parsed = parse(fileContent);
    if (parsed.definitions.length > 1) {
      if (!operationName) {
        throw new Error(
          "this queryfile has multiple operations. Please choose an operation name using --operationName flag."
        );
      }
      const operationDef = parsed.definitions.find((d: any) => {
        return d?.name.value === operationName;
      });
      if (!operationDef) {
        throw new Error(
          "could not find the given operation name in the given queryFIle"
        );
      }
      const queryString = print({
        kind: "Document",
        definitions: [operationDef],
      });
      return queryString;
    }
    return fileContent;
  } catch (e: any) {
    throw new Error(e.message);
  }
};
