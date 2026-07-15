export class AppHttpError extends Error {
  readonly statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'AppHttpError'
    this.statusCode = statusCode
  }
}
