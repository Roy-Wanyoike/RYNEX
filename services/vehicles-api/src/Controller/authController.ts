import { Request, Response } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { v4 as uuid } from 'uuid'
import { db } from '../DatabaseHelper'
import { registration, loginSchema } from '../Helpers'
import { JwtPayload } from '../Models'

interface RegisterBody {
    userName?: string
    email?: string
    password?: string
    address?: string
    fullName?: string
    phoneNo?: string
    country?: string
    [key: string]: unknown
}

interface LoginBody {
    userName?: string
    password?: string
    [key: string]: unknown
}

/** Row shape returned by SpGetSpecificUser (includes the password hash). */
interface UserRow {
    userId: string
    userName: string
    email: string
    password: string
    fullName?: string | null
    isAdmin?: boolean | number | string | null
    [key: string]: unknown
}

const INVALID_CREDENTIALS = { success: false, message: 'Invalid username or password' }

const isDuplicateKeyError = (message: string): boolean =>
    /UNIQUE|duplicate key/i.test(message)

/** Normalizes SQL BIT values (boolean, 1/0, '1'/'0', 'true'/'false') to boolean. */
const normalizeIsAdmin = (value: unknown): boolean => {
    if (value === true || value === 1 || value === '1') return true
    if (typeof value === 'string' && value.toLowerCase() === 'true') return true
    return false
}

export const registerUser = async (req: Request, res: Response): Promise<Response> => {
    try {
        // Never trust a client-supplied role: drop isAdmin before validation.
        const body: RegisterBody = { ...(req.body ?? {}) }
        delete body.isAdmin

        const { error, value } = registration.validate(body, { stripUnknown: true })
        if (error) {
            return res.status(400).json({ success: false, message: error.details[0].message })
        }

        const userId = uuid()
        const passwordHash = await bcrypt.hash(value.password, 10)

        await db.exec('spRegisterUser', {
            IdUser: userId,
            Name: value.userName,
            Email: value.email,
            Password: passwordHash,
            Address: value.address ?? '',
            FullName: value.fullName ?? '',
            PhoneNo: value.phoneNo ?? '',
            Country: value.country ?? ''
        })

        return res.status(201).json({ success: true, message: 'User registered' })
    } catch (err: unknown) {
        console.error('[registerUser] registration failed:', err)
        const message = err instanceof Error ? err.message : String(err)
        if (isDuplicateKeyError(message)) {
            return res.status(409).json({ success: false, message: 'Username or email already exists' })
        }
        return res.status(500).json({ success: false, message: 'Registration failed' })
    }
}

export const login = async (req: Request, res: Response): Promise<Response> => {
    try {
        const body: LoginBody = (req.body ?? {}) as LoginBody

        const { error } = loginSchema.validate({ userName: body.userName, password: body.password })
        if (error) {
            return res.status(400).json({ success: false, message: error.details[0].message })
        }

        const secret = process.env.SECRETKEY
        if (!secret) {
            console.error('[login] SECRETKEY is not configured')
            return res.status(500).json({ success: false, message: 'Server configuration error' })
        }

        const userName = body.userName as string
        const password = body.password as string

        const result = await db.exec('SpGetSpecificUser', { Name: userName })
        const rows = (result.recordset ?? []) as UserRow[]
        const row: UserRow | undefined = rows[0]

        // Same generic message for unknown user and wrong password (no enumeration).
        if (!row) {
            return res.status(401).json(INVALID_CREDENTIALS)
        }

        const storedHash = typeof row.password === 'string' ? row.password : ''
        const passwordMatches = storedHash !== '' && (await bcrypt.compare(password, storedHash))
        if (!passwordMatches) {
            return res.status(401).json(INVALID_CREDENTIALS)
        }

        const payload: JwtPayload = {
            userId: String(row.userId),
            userName: String(row.userName),
            email: String(row.email),
            fullName: row.fullName == null ? '' : String(row.fullName),
            isAdmin: normalizeIsAdmin(row.isAdmin)
        }

        const token = jwt.sign(payload, secret, { expiresIn: '1h' })

        return res.status(200).json({
            success: true,
            message: 'Login successful',
            data: { token, user: payload }
        })
    } catch (err: unknown) {
        console.error('[login] login failed:', err)
        return res.status(500).json({ success: false, message: 'Login failed' })
    }
}
