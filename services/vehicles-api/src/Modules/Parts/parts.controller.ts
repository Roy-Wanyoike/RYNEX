import { Request, Response } from 'express'
import { v4 as uid } from 'uuid'
import { db } from '../../DatabaseHelper'
import { addPartSchema, adjustStockSchema, listPartsQuerySchema } from './parts.schemas'

/**
 * RYNEX Parts module — catalogue & vehicle compatibility (#16).
 *
 * Every handler answers with the global envelope:
 *   success -> 2xx { success: true, message, data? }
 *   failure -> { success: false, message }
 *
 * Raw SQL/driver errors are logged via console.error only — they are never
 * sent to the client (no SQL leakage). Known stored-procedure error numbers
 * (see database/extensions/parts.sql) are mapped to HTTP statuses:
 *   50601 -> 409 (stock adjustment would make quantity negative)
 *   50602 -> 404 (part not found / already removed)
 *
 * Admin enforcement for the write routes lives at router level
 * (verifyToken + requireAdmin), not here.
 */

/** THROW numbers raised by the parts stored procedures. */
const SQL_ERR_STOCK_NEGATIVE = 50601
const SQL_ERR_PART_NOT_FOUND = 50602

/**
 * Extracts the SQL error number from a thrown mssql error without leaking
 * anything else. mssql surfaces THROW/RAISERROR numbers at err.number and
 * sometimes on err.originalError.number.
 */
const sqlErrorNumber = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object') return undefined
  const candidate = error as { number?: unknown; originalError?: { number?: unknown } }
  if (typeof candidate.number === 'number') return candidate.number
  if (candidate.originalError && typeof candidate.originalError.number === 'number') {
    return candidate.originalError.number
  }
  return undefined
}

/**
 * Normalizes an optional filter/input string: undefined, null and blank
 * strings all become undefined so callers can coalesce to SQL NULL and the
 * stored procedures' (@X IS NULL OR column = @X) filters short-circuit.
 */
const orUndefined = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const getPartIdParam = (req: Request): string => {
  const partId = req.params.partId
  return typeof partId === 'string' ? partId.trim() : ''
}

// POST /parts (admin) — create a catalogue part.
// partId is server-owned (uuid); stockQty starts at the table default 0 and
// is only ever changed through PATCH /parts/:partId/stock.
export const addPart = async (req: Request, res: Response): Promise<Response> => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>

    const { error, value } = addPartSchema.validate({
      name: body.name,
      category: body.category,
      brand: body.brand,
      fitsMake: body.fitsMake,
      fitsModel: body.fitsModel,
      fitsYearFrom: body.fitsYearFrom,
      fitsYearTo: body.fitsYearTo,
      price: body.price
    })

    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message })
    }

    // Cross-field rule Joi cannot express inline: the fit window must not end
    // before it starts. Both are optional (universal-fit parts omit them).
    if (value.fitsYearFrom != null && value.fitsYearTo != null && value.fitsYearTo < value.fitsYearFrom) {
      return res.status(400).json({
        success: false,
        message: 'fitsYearTo must be greater than or equal to fitsYearFrom'
      })
    }

    const result = await db.exec('spAddPart', {
      PartId: uid(),
      Name: value.name,
      Category: value.category,
      Brand: orUndefined(value.brand) ?? null,
      FitsMake: orUndefined(value.fitsMake) ?? null,
      FitsModel: orUndefined(value.fitsModel) ?? null,
      FitsYearFrom: value.fitsYearFrom ?? null,
      FitsYearTo: value.fitsYearTo ?? null,
      Price: value.price
    })

    return res.status(201).json({ success: true, message: 'Part added', data: result.recordset?.[0] ?? null })
  } catch (err) {
    console.error('[addPart] failed:', err)
    return res.status(500).json({ success: false, message: 'Failed to add part' })
  }
}

// GET /parts (public) — catalogue with optional compatibility filters.
// ?category&brand&fitsMake&fitsModel — absent or empty query values are
// normalized to NULL so SpGetParts' (@X IS NULL OR column = @X) pattern
// treats them as "no filter" instead of matching empty strings.
export const getParts = async (req: Request, res: Response): Promise<Response> => {
  try {
    const query = req.query ?? {}

    const { error, value } = listPartsQuerySchema.validate({
      category: orUndefined(query.category),
      brand: orUndefined(query.brand),
      fitsMake: orUndefined(query.fitsMake),
      fitsModel: orUndefined(query.fitsModel)
    })

    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message })
    }

    const result = await db.exec('SpGetParts', {
      Category: value.category ?? null,
      Brand: value.brand ?? null,
      FitsMake: value.fitsMake ?? null,
      FitsModel: value.fitsModel ?? null
    })

    return res.status(200).json({ success: true, message: 'Parts fetched', data: result.recordset ?? [] })
  } catch (err) {
    console.error('[getParts] failed:', err)
    return res.status(500).json({ success: false, message: 'Failed to fetch parts' })
  }
}

// GET /parts/:partId (public) — one live part or 404.
export const getOnePart = async (req: Request, res: Response): Promise<Response> => {
  try {
    const partId = getPartIdParam(req)
    if (!partId) {
      return res.status(400).json({ success: false, message: 'Part id is required' })
    }

    const result = await db.exec('spGetOnePart', { PartId: partId })
    const part = result.recordset?.[0]

    if (!part) {
      return res.status(404).json({ success: false, message: 'Part not found' })
    }

    return res.status(200).json({ success: true, message: 'Part fetched', data: part })
  } catch (err) {
    console.error('[getOnePart] failed:', err)
    return res.status(500).json({ success: false, message: 'Failed to fetch part' })
  }
}

// PATCH /parts/:partId/stock (admin) — adjust stock by a signed delta.
// The SP guarantees stockQty never goes negative (THROW 50601 -> 409) and
// that the part exists as a live row (THROW 50602 -> 404).
export const adjustStock = async (req: Request, res: Response): Promise<Response> => {
  try {
    const partId = getPartIdParam(req)
    if (!partId) {
      return res.status(400).json({ success: false, message: 'Part id is required' })
    }

    const body = (req.body ?? {}) as Record<string, unknown>
    const { error, value } = adjustStockSchema.validate({ delta: body.delta })

    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message })
    }

    const result = await db.exec('spAdjustStock', { PartId: partId, Delta: value.delta })

    return res.status(200).json({ success: true, message: 'Stock updated', data: result.recordset?.[0] ?? null })
  } catch (err) {
    const sqlNumber = sqlErrorNumber(err)

    if (sqlNumber === SQL_ERR_STOCK_NEGATIVE) {
      return res.status(409).json({
        success: false,
        message: 'Stock adjustment rejected: quantity would go negative'
      })
    }

    if (sqlNumber === SQL_ERR_PART_NOT_FOUND) {
      return res.status(404).json({ success: false, message: 'Part not found' })
    }

    console.error('[adjustStock] failed:', err)
    return res.status(500).json({ success: false, message: 'Failed to adjust stock' })
  }
}

// DELETE /parts/:partId (admin) — soft delete (isDeleted = 1). Rows are
// never physically removed; 404 when there is no live row to remove.
export const removePart = async (req: Request, res: Response): Promise<Response> => {
  try {
    const partId = getPartIdParam(req)
    if (!partId) {
      return res.status(400).json({ success: false, message: 'Part id is required' })
    }

    await db.exec('spSoftDeletePart', { PartId: partId })

    return res.status(200).json({ success: true, message: 'Part removed' })
  } catch (err) {
    if (sqlErrorNumber(err) === SQL_ERR_PART_NOT_FOUND) {
      return res.status(404).json({ success: false, message: 'Part not found' })
    }

    console.error('[removePart] failed:', err)
    return res.status(500).json({ success: false, message: 'Failed to remove part' })
  }
}
