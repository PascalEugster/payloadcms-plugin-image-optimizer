export const defaultImageOptimizerFields = [
    {
        name: 'thumbHash',
        type: 'text'
    },
    {
        name: 'originalSize',
        type: 'number'
    },
    {
        name: 'optimizedSize',
        type: 'number'
    },
    {
        name: 'status',
        type: 'select',
        options: [
            'pending',
            'processing',
            'complete',
            'error'
        ]
    },
    {
        name: 'error',
        type: 'text'
    },
    {
        name: 'variants',
        type: 'array',
        fields: [
            {
                name: 'format',
                type: 'text'
            },
            {
                name: 'filename',
                type: 'text'
            },
            {
                name: 'filesize',
                type: 'number'
            },
            {
                name: 'width',
                type: 'number'
            },
            {
                name: 'height',
                type: 'number'
            },
            {
                name: 'mimeType',
                type: 'text'
            },
            {
                name: 'url',
                type: 'text'
            }
        ]
    }
];
export const getImageOptimizerField = (fieldsOverride)=>({
        name: 'imageOptimizer',
        type: 'group',
        admin: {
            position: 'sidebar',
            readOnly: true,
            components: {
                Field: '@inoo-ch/payload-image-optimizer/client#OptimizationStatus'
            }
        },
        fields: fieldsOverride ? fieldsOverride({
            defaultFields: defaultImageOptimizerFields
        }) : defaultImageOptimizerFields
    });

//# sourceMappingURL=imageOptimizerField.js.map