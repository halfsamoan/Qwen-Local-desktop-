export function clipboardImageFiles(data: DataTransfer) {
  const files = [
    ...data.files,
    ...[...data.items].filter((item) => item.type.startsWith("image/")).flatMap((item) => item.getAsFile() ?? []),
  ];
  return files.filter((file, index) => file.type.startsWith("image/") && files.findIndex((candidate) => candidate.name === file.name && candidate.size === file.size && candidate.type === file.type) === index);
}
