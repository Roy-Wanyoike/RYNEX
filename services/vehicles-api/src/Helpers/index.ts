import Joi from 'joi'

const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*]).{8,}$/

/**
 * Registration - validates the FULL request body.
 * `isAdmin` is forbidden: the client must never be able to grant itself a role.
 */
export const registration = Joi.object({
    userName: Joi.string().min(3).max(50).trim().required().messages({
        'string.empty': 'User name is required',
        'string.min': 'User name must be at least 3 characters',
        'string.max': 'User name must be at most 50 characters',
        'any.required': 'User name is required'
    }),
    email: Joi.string().email().max(100).required().messages({
        'string.empty': 'Email is required',
        'string.email': 'Please provide a valid email address',
        'string.max': 'Email must be at most 100 characters',
        'any.required': 'Email is required'
    }),
    password: Joi.string().pattern(PASSWORD_PATTERN).required().messages({
        'string.pattern.base': 'Password must be 8+ chars with upper, lower, number and special character',
        'string.empty': 'Password is required',
        'any.required': 'Password is required'
    }),
    address: Joi.string().allow('', null).max(100).optional(),
    fullName: Joi.string().allow('', null).max(100).optional(),
    phoneNo: Joi.string().allow('', null).max(100).optional(),
    country: Joi.string().allow('', null).max(100).optional(),
    isAdmin: Joi.forbidden()
})

/**
 * Login - no password pattern here: legacy users may have weaker passwords.
 * Only checks that both fields are present strings.
 */
export const loginSchema = Joi.object({
    userName: Joi.string().required().messages({
        'string.empty': 'User name is required',
        'any.required': 'User name is required'
    }),
    password: Joi.string().required().messages({
        'string.empty': 'Password is required',
        'any.required': 'Password is required'
    })
})

export const car = Joi.object({
    carId: Joi.string().optional(),
    model: Joi.string().required(),
    bodyType: Joi.string().required(),
    brand: Joi.string().required(),
    prices: Joi.number().positive().required(),
    pictureUrl: Joi.string().optional(),
    isDeleted: Joi.alternatives()
        .try(
            Joi.boolean(),
            Joi.string().valid('0', '1')
        )
        .allow(null)
        .optional()
})

export const cartSchema = Joi.object({
    carId: Joi.string().guid().required().messages({
        'string.guid': 'A valid carId (uuid) is required',
        'string.empty': 'carId is required',
        'any.required': 'carId is required'
    }),
    quantity: Joi.number().integer().min(1).max(99).required().messages({
        'number.base': 'quantity must be a number',
        'number.integer': 'quantity must be a whole number',
        'number.min': 'quantity must be at least 1',
        'number.max': 'quantity must be at most 99',
        'any.required': 'quantity is required'
    })
})
