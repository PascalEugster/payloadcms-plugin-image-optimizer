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
            'complete',
            'error'
        ]
    },
    {
        name: 'error',
        type: 'text'
    }
];
export const getImageOptimizerField = (opts)=>{
    // When `storeBlurDataURL` is on we extend the public baseline with a hidden
    // readOnly `blurDataURL` field. This is handed to `fieldsOverride` as the
    // `defaultFields` arg, so consumers who spread `defaultFields` in their
    // override automatically pick up the new field — no second opt-in required.
    const base = opts.storeBlurDataURL ? [
        ...defaultImageOptimizerFields,
        {
            name: 'blurDataURL',
            type: 'text',
            admin: {
                hidden: true,
                readOnly: true
            }
        }
    ] : defaultImageOptimizerFields;
    return {
        name: 'imageOptimizer',
        type: 'group',
        admin: {
            position: 'sidebar',
            readOnly: true,
            components: {
                Field: '@inoo-ch/payload-image-optimizer/client#OptimizationStatus'
            }
        },
        fields: opts.fieldsOverride ? opts.fieldsOverride({
            defaultFields: base
        }) : base
    };
};

//# sourceMappingURL=imageOptimizerField.js.map