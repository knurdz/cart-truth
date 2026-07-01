const SECRET_PATTERN = /([A-Za-z0-9._%+-]{2,}:)[^@\s/]+(@)/g;

export function redactText(input: string, explicitSecrets: string[] = []): string {
  let output = input.replace(SECRET_PATTERN, "$1***$2");

  for (const secret of explicitSecrets.filter(Boolean)) {
    output = output.split(secret).join("***");
  }

  return output;
}

export function redactRecord<T>(value: T, explicitSecrets: string[] = []): T {
  return JSON.parse(redactText(JSON.stringify(value), explicitSecrets)) as T;
}
