import {ArrayType, NumberType, ObjectType, StringType, UnionType} from '@croct/plug/sdk/validation';

export const propertiesSchema = new ObjectType({
    required: ['testId', 'groupId'],
    properties: {
        testId: new StringType({minLength: 1}),
        groupId: new StringType({minLength: 1}),
    },
});

const abTestSchema = new ObjectType({
    required: ['groups'],
    properties: {
        groups: new UnionType(
            new ArrayType({
                minItems: 1,
                items: new StringType({
                    minLength: 1,
                }),
            }),
            new ObjectType({
                minProperties: 1,
                additionalProperties: new ObjectType({
                    required: ['weight'],
                    properties: {
                        weight: new NumberType({
                            minimum: 0,
                        }),
                    },
                }),
            }),
        ),
    },
});

const multivariateTestSchema = new ObjectType({
    required: ['groups'],
    properties: {
        groups: new ArrayType({
            minItems: 1,
            items: new ArrayType({
                minItems: 1,
                items: new StringType({
                    minLength: 1,
                }),
            }),
        }),
    },
});

export const definitionsSchema = new ObjectType({
    additionalProperties: new ObjectType({
        required: ['type'],
        additionalProperties: true,
        properties: {
            type: new StringType({
                enumeration: ['ab', 'multivariate'],
            }),
            traffic: new NumberType({
                minimum: 0,
                maximum: 1,
            }),
            audience: new StringType({minLength: 1}),
        },
        subtypes: {
            discriminator: 'type',
            schemas: {
                ab: abTestSchema,
                multivariate: multivariateTestSchema,
            },
        },
    }),
});
