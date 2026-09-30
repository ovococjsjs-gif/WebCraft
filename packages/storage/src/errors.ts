export type SaveErrorCode =
  'CORRUPT' | 'UNSUPPORTED' | 'LIMIT' | 'CONFLICT' | 'NOT_FOUND' | 'UNAVAILABLE' | 'QUOTA' | 'IO';
export class SaveError extends Error {
  constructor(
    readonly code: SaveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SaveError';
  }
}
export function storageError(error: unknown): SaveError {
  if (error instanceof SaveError) return error;
  if (error instanceof Error && error.name === 'QuotaExceededError')
    return new SaveError(
      'QUOTA',
      'В браузере недостаточно места. Последняя сохранённая копия не изменена. Экспортируй мир в файл.',
    );
  if (
    error instanceof Error &&
    (error.name === 'SecurityError' || error.name === 'InvalidStateError')
  )
    return new SaveError('UNAVAILABLE', 'В этом окне браузер не разрешает постоянное хранилище.');
  return new SaveError(
    'IO',
    error instanceof Error
      ? error.message
      : 'Не удалось записать сохранение. Предыдущая запись не заменена.',
  );
}
