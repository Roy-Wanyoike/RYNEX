/**
 * Shared domain types (previously classes with constructors — now plain
 * interfaces so they can describe DB rows and request payloads alike).
 */

export interface UserRegistrationType {
    userId: string
    userName: string
    email: string
    password: string
    address: string
    fullName: string
    phoneNo: string
    country: string
    /** BIT from SQL may arrive as boolean, 1/0, or '1'/'0' */
    isAdmin?: boolean | string | number
}

export interface ProductType {
    carId: string
    model: string
    bodyType: string
    brand: string
    prices: number
    /** BIT from SQL may arrive as boolean, 1/0, or '1'/'0' */
    isDeleted?: boolean | string | number
    pictureUrl?: string
}

export interface CartRecord {
    cardID: string
    userId: string
    carId: string
    carBrand: string
    prices: number
    quantity: number
    model?: string
    pictureUrl?: string
}

/** JWT payload — also the shape of the `user` object returned by login. */
export interface JwtPayload {
    userId: string
    userName: string
    email: string
    fullName: string
    isAdmin: boolean
}
