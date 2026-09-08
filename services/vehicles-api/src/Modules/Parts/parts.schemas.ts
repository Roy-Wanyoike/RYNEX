import Joi from 'joi'

/**
 * Parts module — Joi schemas (module-local by design; src/Helpers is owned
 * by another workstream, so validation lives here per the module contract).
 */

const YEAR_MIN = 1900
const YEAR_MAX = 2100

/** POST /parts — create a catalogue part (admin). */
export const addPartSchema = Joi.object({
    name: Joi.string().trim().min(1).max(100).required().messages({
        'string.empty': 'name is required',
        'string.min': 'name must be at least 1 character',
        'string.max': 'name must be at most 100 characters',
        'any.required': 'name is required'
    }),
    category: Joi.string().trim().min(1).max(50).required().messages({
        'string.empty': 'category is required',
        'string.min': 'category must be at least 1 character',
        'string.max': 'category must be at most 50 characters',
        'any.required': 'category is required'
    }),
    brand: Joi.string().trim().allow('', null).max(50).optional().messages({
        'string.max': 'brand must be at most 50 characters'
    }),
    fitsMake: Joi.string().trim().allow('', null).max(50).optional().messages({
        'string.max': 'fitsMake must be at most 50 characters'
    }),
    fitsModel: Joi.string().trim().allow('', null).max(50).optional().messages({
        'string.max': 'fitsModel must be at most 50 characters'
    }),
    fitsYearFrom: Joi.number().integer().min(YEAR_MIN).max(YEAR_MAX).optional().messages({
        'number.base': 'fitsYearFrom must be a number',
        'number.integer': 'fitsYearFrom must be a whole year',
        'number.min': `fitsYearFrom must be ${YEAR_MIN} or later`,
        'number.max': `fitsYearFrom must be ${YEAR_MAX} or earlier`
    }),
    fitsYearTo: Joi.number().integer().min(YEAR_MIN).max(YEAR_MAX).optional().messages({
        'number.base': 'fitsYearTo must be a number',
        'number.integer': 'fitsYearTo must be a whole year',
        'number.min': `fitsYearTo must be ${YEAR_MIN} or later`,
        'number.max': `fitsYearTo must be ${YEAR_MAX} or earlier`
    }),
    price: Joi.number().positive().precision(2).max(99999999.99).required().messages({
        'number.base': 'price must be a number',
        'number.positive': 'price must be greater than 0',
        'number.max': 'price must be at most 99999999.99',
        'any.required': 'price is required'
    })
})

/** PATCH /parts/:partId/stock — stock adjustment delta (admin). */
export const adjustStockSchema = Joi.object({
    delta: Joi.number().integer().min(-999).max(999).required().messages({
        'number.base': 'delta must be a number',
        'number.integer': 'delta must be a whole number',
        'number.min': 'delta must be at least -999',
        'number.max': 'delta must be at most 999',
        'any.required': 'delta is required'
    })
})

/** GET /parts — catalogue filters (public). Keys are optional; the
 *  controller normalizes absent/empty filters to NULL for the SP. */
export const listPartsQuerySchema = Joi.object({
    category: Joi.string().trim().min(1).max(50).optional().messages({
        'string.max': 'category filter must be at most 50 characters'
    }),
    brand: Joi.string().trim().min(1).max(50).optional().messages({
        'string.max': 'brand filter must be at most 50 characters'
    }),
    fitsMake: Joi.string().trim().min(1).max(50).optional().messages({
        'string.max': 'fitsMake filter must be at most 50 characters'
    }),
    fitsModel: Joi.string().trim().min(1).max(50).optional().messages({
        'string.max': 'fitsModel filter must be at most 50 characters'
    })
})
