const Joi = require('joi');

const registrationSchema = Joi.object({
  companyName: Joi.string()
    .min(2)
    .max(255)
    .required()
    .messages({
      'string.min': 'Company name must be at least 2 characters long',
      'string.max': 'Company name must not exceed 255 characters',
      'any.required': 'Company name is required'
    }),
  
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required'
    }),
  
  mobileNumber: Joi.string()
    .pattern(/^[+]?[1-9][\d\s\-\(\)]{8,20}$/)
    .required()
    .messages({
      'string.pattern.base': 'Please provide a valid mobile number',
      'any.required': 'Mobile number is required'
    }),
  
  countryCode: Joi.string()
    .pattern(/^\+[1-9]\d{0,3}$/)
    .default('+61')
    .messages({
      'string.pattern.base': 'Please provide a valid country code (e.g., +61, +1, +44)',
      'string.base': 'Country code must be a string'
    }),
  
  password: Joi.string()
    .min(8)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .required()
    .messages({
      'string.min': 'Password must be at least 8 characters long',
      'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character',
      'any.required': 'Password is required'
    })
});

const loginSchema = Joi.object({
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required'
    }),
  
  password: Joi.string()
    .required()
    .messages({
      'any.required': 'Password is required'
    })
});

const complianceSchema = Joi.object({
  basFrequency: Joi.string()
    .valid('Monthly', 'Quarterly', 'Annually')
    .required()
    .messages({
      'any.only': 'BAS frequency must be either Monthly, Quarterly, or Annually',
      'any.required': 'BAS frequency is required'
    }),
  
  fbtApplicable: Joi.boolean()
    .required()
    .messages({
      'any.required': 'FBT applicable field is required'
    }),
  
  financialYearEnd: Joi.date()
    .required()
    .messages({
      'date.base': 'Please provide a valid financial year end date',
      'any.required': 'Financial year end date is required'
    })
});

const profileUpdateSchema = Joi.object({
  companyName: Joi.string()
    .min(2)
    .max(255)
    .required()
    .messages({
      'string.min': 'Company name must be at least 2 characters long',
      'string.max': 'Company name must not exceed 255 characters',
      'any.required': 'Company name is required'
    }),
  
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required'
    }),
  
  mobileNumber: Joi.string()
    .pattern(/^[+]?[1-9][\d\s\-\(\)]{8,20}$/)
    .required()
    .messages({
      'string.pattern.base': 'Please provide a valid mobile number',
      'any.required': 'Mobile number is required'
    }),
  
  countryCode: Joi.string()
    .pattern(/^\+[1-9]\d{1,4}$/)
    .default('+61')
    .messages({
      'string.pattern.base': 'Please provide a valid country code (e.g., +61, +1, +44)',
      'string.base': 'Country code must be a string'
    }),
  
  accountantEmail: Joi.string()
    .email()
    .allow('', null)
    .optional()
    .messages({
      'string.email': 'Please provide a valid accountant email address'
    })
});

const complianceDetailsSchema = Joi.object({
  basFrequency: Joi.string().valid('Monthly', 'Quarterly', 'Annually').required(),
  nextBasDue: Joi.date().greater('now').required(),
  fbtApplicable: Joi.boolean().required(),
  nextFbtDue: Joi.when('fbtApplicable', {
    is: true,
    then: Joi.date().greater('now').required(),
    otherwise: Joi.forbidden()
  }),
  iasRequired: Joi.boolean().required(),
  iasFrequency: Joi.when('iasRequired', {
    is: true,
    then: Joi.string().valid('Monthly', 'Quarterly', 'Annually').required(),
    otherwise: Joi.forbidden()
  }),
  nextIasDue: Joi.when('iasRequired', {
    is: true,
    then: Joi.date().greater('now').required(),
    otherwise: Joi.forbidden()
  }),
  financialYearEnd: Joi.date().required()
});

const superAdminCompanyUpdateSchema = Joi.object({
  companyName: Joi.string()
    .min(2)
    .max(255)
    .required()
    .messages({
      'string.min': 'Company name must be at least 2 characters long',
      'string.max': 'Company name must not exceed 255 characters',
      'any.required': 'Company name is required'
    }),
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required'
    }),
  mobileNumber: Joi.string()
    .pattern(/^[+]?[1-9][\d\s\-\(\)]{8,20}$/)
    .required()
    .messages({
      'string.pattern.base': 'Please provide a valid mobile number',
      'any.required': 'Mobile number is required'
    }),
  countryCode: Joi.string()
    .pattern(/^\+[1-9]\d{0,3}$/)
    .default('+61')
    .messages({
      'string.pattern.base': 'Please provide a valid country code (e.g., +61, +1, +44)',
      'string.base': 'Country code must be a string'
    }),
  isActive: Joi.boolean().optional()
});

module.exports = {
  registrationSchema,
  loginSchema,
  complianceSchema,
  profileUpdateSchema,
  complianceDetailsSchema, // Export new schema
  superAdminCompanyUpdateSchema // Export super admin update schema
};
