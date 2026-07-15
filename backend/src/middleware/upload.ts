import multer from 'multer'
import { env } from '../config/env'
import { isBlockedExecutable } from '../utils/filename'

function rejectExecutable(
  cb: multer.FileFilterCallback,
  filename: string,
  mimetype: string,
): void {
  if (isBlockedExecutable(filename, mimetype)) {
    cb(new Error('Исполняемые файлы прикреплять нельзя'))
    return
  }
  cb(null, true)
}

export const uploadAttachment = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAIL_MAX_ATTACHMENT_SIZE },
  fileFilter: (_req, file, cb) => {
    rejectExecutable(cb, file.originalname, file.mimetype)
  },
})

const AVATAR_MAX_SIZE = 2 * 1024 * 1024

export const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|gif|webp)$/.test(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Допустимы только изображения PNG, JPEG, GIF или WEBP'))
    }
  },
})
