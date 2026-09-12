// Auto-generated from your database schema — do not edit by hand.
// Regenerates automatically whenever a table is created or altered.

export type QbDatabasesRow = {
  id: string
  userId: string
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
}

export type QbFieldsRow = {
  id: string
  tableId: string
  userId: string
  name: string
  fieldType: string
  required: boolean
  position: number | string
  createdAt: string
}

export type QbRecordsRow = {
  id: string
  tableId: string
  userId: string
  data: string
  createdAt: string
  updatedAt: string
}

export type QbTablesRow = {
  id: string
  databaseId: string
  userId: string
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
}
