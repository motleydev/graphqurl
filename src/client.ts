import { cloneObject, wsScheme } from "./utils";
import isoFetch from "isomorphic-fetch";
import ws, { ClientOptions, WebSocketServer } from "isomorphic-ws";

import {
  GQL_CONNECTION_INIT,
  GQL_START,
  GQL_STOP,
  GRAPHQL_SUBSCRIPTIONS_PROTOCOL,
  handler as wsEventHandler,
} from "./events";

export type WSEvent = { type?: string; payload?: any; id?: string };

export type WebSocketOpts = {
  endpoint: string | URL;
  shouldRetry?: boolean;
  parameters?: object;
  client?: WebSocket | null;
  subscriptions?: Record<string, SubscriptionOpts>;
  onConnectionSuccess?(a?: void): void;
  onConnectionError?(a?: Error): null;
  onConnectionKeepAlive?(a?: void): null;
};

export interface ClientOpts extends ClientOptions {
  endpoint: string | URL;
  headers?: Record<string, any>;
  websocket?: WebSocketOpts;
  hook?: any; // What does this do?
}
export type GraphQLRequestVariable = Record<string, any>;

export type QueryOpts = {
  query: string;
  headers?: Headers;
  variables?: GraphQLRequestVariable;
};

export type GraphQLResponse<T = any> = {
  data: T;
  errors: Error[];
};

export type SubscriptionOpts = {
  subscription?: string;
  variables?: GraphQLRequestVariable;
  onGraphQLData?(a: GraphQLResponse): null;
  onGraphQLError?(a: GraphQLResponse): null;
  onGraphQLComplete?(): null;
};

export type QuerySuccessCallback = (
  response: GraphQLResponse,
  ...a: any
) => null;
export type QueryErrorCallback = (error: Error, ...a: any) => null;
export type SubscriptionSuccessCallback = (
  response: GraphQLResponse,
  ...a: any
) => null;
export type SubscriptionErrorCallback = (error: Error, ...a: any) => null;

export type Client = {
  query(
    queryOpts: QueryOpts,
    successCallback?: QuerySuccessCallback,
    errorCallback?: QueryErrorCallback
  ): Promise<GraphQLResponse>;
  subscribe(
    subscriptionOpts: SubscriptionOpts,
    successCallback?: SubscriptionSuccessCallback,
    errorCallback?: SubscriptionErrorCallback
  ): { stop: () => void } | undefined;
  updateHeaders?(newHeaders: Record<string, any>): void;
};

export type ClientContext = {
  endpoint: string;
  headers?: Headers;
  websocket?: Partial<WebSocketOpts>;
};

const makeClient = (options: ClientOpts): Client => {
  const { endpoint, websocket, headers, hook } = options;

  const clientContext = {
    endpoint,
    headers: cloneObject(headers || {}),
    websocket: {
      ...websocket,
      endpoint:
        (websocket && websocket.endpoint) || wsScheme(endpoint as string),
      parameters: (websocket && websocket.parameters) || {},
      client: null,
      open: false,
      subscriptions: {},
    },
  } as ClientContext;

  const executeQuery = async (
    queryOptions: QueryOpts,
    successCallback?: QuerySuccessCallback,
    errorCallback?: QueryErrorCallback
  ) => {
    const { query, variables, headers: headerOverrides } = queryOptions;

    const headers = {
      ...clientContext.headers,
      ...(headerOverrides || {}),
    } as Record<string, any>;
    const isExistContentTypeKey = Object.keys(headers).some((key) =>
      /content-type/gi.test(key)
    );
    if (!isExistContentTypeKey) {
      headers["Content-Type"] = "application/json";
    }

    try {
      const response = await isoFetch(clientContext.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables: variables || {} }),
      });
      const responseObj = await response.json();
      if (hook) {
        hook(responseObj);
      }
      if (responseObj.errors) {
        if (errorCallback) {
          errorCallback(responseObj);
        }
        throw responseObj;
      } else {
        if (successCallback) {
          successCallback(responseObj);
        }
        return responseObj;
      }
    } catch (e: any) {
      if (e.errors) {
        throw e;
      } else {
        throw {
          errors: [
            {
              message: "failed to fetch",
            },
          ],
        };
      }
    }
  };

  const makeWsClient = async () => {
    if (clientContext.websocket) {
      try {
        const wsConnection = new ws(
          clientContext.websocket.endpoint as string,
          GRAPHQL_SUBSCRIPTIONS_PROTOCOL
        );
        return wsConnection;
      } catch (e: any) {
        console.log(e);
        throw new Error(
          "Failed to establish the WebSocket connection: " + e.message
        );
      }
    } else {
      throw new Error("Missing websocket parameters.");
    }
  };

  const sendWsEvent = (data: WSEvent) => {
    clientContext?.websocket?.client?.send(JSON.stringify(data));
  };

  const setWsClient = (_wsClient: WebSocket): void | PromiseLike<void> => {
    if (clientContext.websocket) {
      clientContext.websocket.client = _wsClient;

      if (clientContext.websocket.shouldRetry) {
        _wsClient.onclose = () => {
          makeWsClient().then(() => {
            setWsClient;
          });
        };
      }

      _wsClient.addEventListener("open", () => {
        const payload = {
          ...clientContext.websocket?.parameters,
          headers: {
            ...clientContext.headers,
            //@ts-ignore
            ...clientContext.websocket?.parameters?.headers,
          },
        };
        sendWsEvent({
          type: GQL_CONNECTION_INIT,
          payload,
        });
      });

      _wsClient.addEventListener("message", (event) => {
        wsEventHandler(clientContext.websocket, event);
      });
    }
  };
  if (websocket) {
    makeWsClient()
      //@ts-ignore
      .then(setWsClient)
      .catch((e) => {
        console.error(e);
      });
  }

  const subscribe = (
    subscriptionOptions: SubscriptionOpts,
    successCallback?: SubscriptionSuccessCallback,
    errorCallback?: SubscriptionErrorCallback
  ) => {
    if (!clientContext?.websocket?.client) {
      console.log("WebSocket connection has not been established");
      return;
    }

    const {
      subscription,
      variables,
      onGraphQLData,
      onGraphQLError,
      onGraphQLComplete,
    } = subscriptionOptions;

    const generateOperationId = () => {
      let id = "";
      const characters =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      for (let _i = 0; _i < 5; _i++) {
        id += characters.charAt(Math.floor(Math.random() * characters.length));
      }
      return (
        id +
        (Object.keys(clientContext?.websocket?.subscriptions as {}).length + 1)
      );
    };

    const operationId = generateOperationId();

    if (clientContext?.websocket?.subscriptions) {
      clientContext.websocket.subscriptions[operationId] = {
        onGraphQLData: (data: any): null => {
          if (onGraphQLData) {
            onGraphQLData(data);
          }
          if (successCallback) {
            successCallback(data);
          }
          return null;
        },
        onGraphQLComplete,
        onGraphQLError: (data: any): null => {
          if (onGraphQLError) {
            onGraphQLError(data);
          }
          if (errorCallback) {
            errorCallback(data);
          }
          return null;
        },
      };
    }

    sendWsEvent({
      type: GQL_START,
      id: operationId,
      payload: {
        query: subscription,
        variables: variables || {},
      },
    });

    return {
      stop: () => {
        sendWsEvent({
          type: GQL_STOP,
          id: operationId,
        });
      },
    };
  };

  const updateHeaders = (newHeaders: Record<string, any>) => {
    clientContext.headers = cloneObject(newHeaders);
    if (clientContext?.websocket?.client) {
      makeWsClient()
        //@ts-ignore
        .then(setWsClient)
        .catch((e) => {
          console.error(e);
        });
    }
  };

  return {
    query: executeQuery,
    subscribe: subscribe,
    updateHeaders,
  };
};

export default makeClient;
