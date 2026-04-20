import type { Field, GroupField } from 'payload'

import type { FieldsOverride } from '../types.js'

export const defaultImageOptimizerFields: Field[] = [
  {
    name: 'thumbHash',
    type: 'text',
  },
  {
    name: 'originalSize',
    type: 'number',
  },
  {
    name: 'optimizedSize',
    type: 'number',
  },
  {
    name: 'status',
    type: 'select',
    options: ['complete', 'error'],
  },
  {
    name: 'error',
    type: 'text',
  },
]

export const getImageOptimizerField = (fieldsOverride?: FieldsOverride): GroupField => ({
  name: 'imageOptimizer',
  type: 'group',
  admin: {
    position: 'sidebar',
    readOnly: true,
    components: {
      Field: '@inoo-ch/payload-image-optimizer/client#OptimizationStatus',
    },
  },
  fields: fieldsOverride
    ? fieldsOverride({ defaultFields: defaultImageOptimizerFields })
    : defaultImageOptimizerFields,
})
