export interface Admission_Write {
  student_id: number
  class_id: number
  amount: number
  monthly: number
  date: string
  remark?: string
}

export interface Admission_Insert_Update extends Admission_Write {
  paid: number
}

export interface Admission_Record {
  id: number
  class: string
  amount: number
  paid: number
  date: string
  remark?: string | null
}

export interface Admission_Read {
  amount: number
  student_id: number
  paid: number
  class_id: number
  date: string
  remark?: string | null
}

export interface Admission_Read_Paid_Unpaid {
  id: number
  amount: number
  paid: number
}
