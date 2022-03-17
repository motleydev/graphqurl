const throwError = (err: any) => {
  console.error("Error: ", err);
  process.exit(1);
};

export const handleGraphQLError = (err: any) => {
  if (err.message) {
    let errorMessage = err.message;
    if (err.locations) {
      let locs = [];
      for (const l of err.locations) {
        locs.push(`line: ${l.line}, column: ${l.column}`);
      }
      errorMessage += `\n${locs.join(",")}`;
    }
    throwError(errorMessage);
  } else {
    throwError(err);
  }
};

export const handleServerError = (err: any) => {
  if (err.networkError && err.networkError.statusCode) {
    if (err.networkError.result && err.networkError.result.errors) {
      let errorMessages = [];
      for (const e of err.networkError.result.errors) {
        errorMessages.push(`[${e.code}] at [${e.path}]: ${e.error}`);
      }
      throwError(errorMessages.join("\n"));
    } else {
      throwError(err.message);
    }
  } else {
    throwError(err);
  }
};
