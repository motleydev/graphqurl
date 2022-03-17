import {
  GraphQLResponse,
  QueryErrorCallback,
  QueryOpts,
  QuerySuccessCallback,
  SubscriptionErrorCallback,
  SubscriptionSuccessCallback,
} from "./client";

import makeClient from "./client";
import { wsScheme } from "./utils";
import { parse } from "graphql/language";

interface QueryOptsUtils extends QueryOpts {
  endpoint: string;
  name: string;
}

export const query = async function (
  options: QueryOptsUtils,
  successCb: SubscriptionSuccessCallback,
  errorCb: any
) {
  const { query, endpoint, headers, variables, name } = options;
  let client = makeClient({
    endpoint,
    headers,
  });

  let input: any, queryType: any;
  try {
    input = parse(query);

    if (input.definitions && input.definitions.length > 0) {
      if (name) {
        if (input.definitions.length > 1) {
          let found = false;
          for (let d of input.definitions) {
            if (d.name.value === name) {
              input = { kind: "Document", definitions: [d] };
              queryType = d.operation;
              found = true;
              break;
            }
          }
          if (!found) {
            if (!errorCb) {
              throw {
                error: `query with name '${name}' not found in input`,
              };
            }
            errorCb(
              {
                error: `query with name '${name}' not found in input`,
              },
              null,
              input
            );
            return;
          }
        } else if (input.definitions[0].name.value !== name) {
          if (!errorCb) {
            throw {
              error: `query with name '${name}' not found in input`,
            };
          }
          errorCb(
            {
              error: `query with name '${name}' not found in input`,
            },
            null,
            input
          );
          return;
        }
      }
      queryType = input.definitions[0].operation;
    }
  } catch (err) {
    if (!errorCb) {
      throw err;
    }
    errorCb(err, null, input);
  }

  const subSuccessCallbackWrapper =
    (callback: SubscriptionSuccessCallback) =>
    (data: GraphQLResponse): null => {
      callback(data, queryType, input);
      return null;
    };
  const subErrorCallbackWrapper =
    (callback: SubscriptionErrorCallback) =>
    (data: Error): null => {
      callback(data, queryType, input);
      return null;
    };

  const querySuccessCallbackWrapper =
    (callback: QuerySuccessCallback) =>
    (data: GraphQLResponse): null => {
      callback(data, queryType, input);
      return null;
    };
  const queryErrorCallbackWrapper =
    (callback: QueryErrorCallback) =>
    (data: Error): null => {
      callback(data, queryType, input);
      return null;
    };

  try {
    if (queryType === "subscription") {
      client = makeClient({
        endpoint,
        headers,
        websocket: {
          endpoint: wsScheme(endpoint),
          onConnectionSuccess: () => {
            client.subscribe(
              {
                subscription: query,
                variables,
              },
              subSuccessCallbackWrapper(successCb),
              subErrorCallbackWrapper(errorCb)
            );
          },
        },
      });
    } else {
      await client.query(
        {
          query: query,
          variables,
        },
        querySuccessCallbackWrapper(successCb),
        queryErrorCallbackWrapper(errorCb)
      );
    }
  } catch (err) {
    errorCb(err, null, null);
  }
};
