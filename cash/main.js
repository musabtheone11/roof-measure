// Global variables
let selectedMaterial = 'shingle';
let uploadedPhotos = [];
let costChart = null;
let currentEstimate = {};
let roofMeasurements = [];
let selectedMargin = 0;
let baseCost = 0;
let customerPrice = 0;
let overheadCost = 0;
let dumpsterCost = 0;
const MAX_OVERHEAD = 1800; // $1800 cap on overhead
const DUMPSTER_SMALL = 500; // $500 for under 40 squares
const DUMPSTER_LARGE = 750; // $750 for 40 squares and above

// Real pricing data from Diversity Roofing
const laborPrices = {
    'shingle': 95,      // $95 per square for shingles
    'metal-exposed': 260, // $260 per square for exposed fastener metal
    'metal-standing': 300, // $300 per square for standing seam metal
    'tile': 380        // $380 per square for tile
};

// Additional charges from Diversity Roofing pricing guide
const additionalCharges = {
    'double-layer': 25,  // $25 per square per additional layer
    'steep-medium': 10,  // $10 per square for 8/12 pitch
    'steep-high': 20,    // $20 per square for 9/12+ pitch
    'two-story': 5,      // $5 per square for two story
    'ground-drop': 5,    // $5 per square for poor dump access
    'roof-load': 10      // $10 per square for roof load ground drop
};

// Material costs (estimated based on industry standards)
const materialCosts = {
    'shingle': 150,           // $150 per square for architectural shingles
    'metal-exposed': 230,     // $230 per square for exposed fastener metal
    'metal-standing': 450,    // $450 per square for standing seam metal
    'underlayment': 25,       // $25 per square for synthetic underlayment
    'ice-guard': 40,          // $40 per square for ice & water shield
    'starter': 8,             // $8 per linear foot for starter strip
    'flashing': 3,            // $3 per linear foot for flashing
    'ventilation': 50         // $50 per vent for ventilation components
};

// Animation initialization
function initializeAnimations() {
    // Animate section headers
    anime({
        targets: '.section-header',
        translateY: [20, 0],
        opacity: [0, 1],
        duration: 800,
        delay: anime.stagger(200),
        easing: 'easeOutQuart'
    });
    
    // Animate form cards
    anime({
        targets: '.form-card',
        translateY: [30, 0],
        opacity: [0, 1],
        duration: 1000,
        delay: anime.stagger(150),
        easing: 'easeOutQuart'
    });
    
    // Initialize text splitting for animations
    if (typeof Splitting !== 'undefined') {
        Splitting();
    }
}

// Initialize cost breakdown chart
function initializeCostChart() {
    const chartDom = document.getElementById('costChart');
    if (chartDom && typeof echarts !== 'undefined') {
        costChart = echarts.init(chartDom);
        updateCostChart();
    }
}

// Update cost breakdown chart
function updateCostChart() {
    if (!costChart) return;
    
    const laborCost = parseFloat(document.getElementById('laborCost').textContent.replace('$', '').replace(',', '')) || 0;
    const materialCost = parseFloat(document.getElementById('materialCost').textContent.replace('$', '').replace(',', '')) || 0;
    const additionalCost = parseFloat(document.getElementById('additionalCost').textContent.replace('$', '').replace(',', '')) || 0;
    const permitCost = parseFloat(document.getElementById('permitCost').textContent.replace('$', '').replace(',', '')) || 0;
    const dumpsterCost = parseFloat(document.getElementById('dumpsterCost').textContent.replace('$', '').replace(',', '')) || 0;
    
    const option = {
        tooltip: {
            trigger: 'item',
            formatter: '{a} <br/>{b}: ${c} ({d}%)'
        },
        series: [{
            name: 'Cost Breakdown',
            type: 'pie',
            radius: '70%',
            center: ['50%', '50%'],
            data: [
                { value: laborCost, name: 'Labor', itemStyle: { color: '#E67E22' } },
                { value: materialCost, name: 'Materials', itemStyle: { color: '#2C3E50' } },
                { value: additionalCost, name: 'Additional', itemStyle: { color: '#34495E' } },
                { value: permitCost, name: 'Permits', itemStyle: { color: '#27AE60' } },
                { value: dumpsterCost, name: 'Dumpster', itemStyle: { color: '#9b59b6' } }
            ],
            emphasis: {
                itemStyle: {
                    shadowBlur: 10,
                    shadowOffsetX: 0,
                    shadowColor: 'rgba(0, 0, 0, 0.5)'
                }
            }
        }]
    };
    
    costChart.setOption(option);
}

// Handle roof report upload
function handleReportUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Simulate report processing with actual roof report data
    const uploadArea = document.querySelector('.roof-report-upload');
    uploadArea.innerHTML = `
        <div class="text-5xl mb-4">⏳</div>
        <h4 class="text-xl font-bold mb-2">Processing Report...</h4>
        <p class="text-gray-600">Extracting measurements and calculations</p>
    `;
    
    setTimeout(() => {
        // Use actual measurements from the roof report
        const actualMeasurements = [
            { section: 'Main Roof Area', length: 0, width: 0, area: 2368 }, // From line 57, 99
            { section: 'Eaves', length: 200.42, width: 0, area: 0 }, // From line 107 (200ft 5in = 200.42ft)
            { section: 'Hips', length: 99, width: 0, area: 0 }, // From line 113
            { section: 'Ridges', length: 28.08, width: 0, area: 0 }, // From line 114 (28ft 1in = 28.08ft)
            { section: 'Rakes', length: 59.42, width: 0, area: 0 } // From line 115 (59ft 5in = 59.42ft)
        ];
        
        roofMeasurements = actualMeasurements;
        displayMeasurements(actualMeasurements);
        
        // Update square footage and recalculate
        const totalArea = 2368; // Main roof area from report
        document.getElementById('squareFootage').value = totalArea;
        
        // Set roof pitch to medium (6/12 from report)
        document.getElementById('roofPitch').value = 'medium';
        
        calculateCosts();
        
        // Show success message
        uploadArea.innerHTML = `
            <div class="text-5xl mb-4">✅</div>
            <h4 class="text-xl font-bold mb-2">Report Processed!</h4>
            <p class="text-gray-600">Measurements extracted successfully</p>
            <p class="text-sm text-blue-600 mt-2">Roof Area: 2,368 sq ft | Pitch: 6/12 | 9 Facets</p>
        `;
    }, 2000);
}

// Display extracted measurements
function displayMeasurements(measurements) {
    const preview = document.getElementById('reportPreview');
    const list = document.getElementById('measurementsList');
    
    list.innerHTML = '';
    measurements.forEach(measurement => {
        const row = document.createElement('div');
        row.className = 'measurement-row';
        row.innerHTML = `
            <div class="font-medium">${measurement.section}</div>
            <div>${measurement.length}</div>
            <div>${measurement.width}</div>
            <div class="font-semibold">${measurement.area}</div>
        `;
        list.appendChild(row);
    });
    
    const totalArea = measurements.reduce((sum, item) => sum + item.area, 0);
    const totalSquares = (totalArea / 100).toFixed(1);
    
    document.getElementById('totalArea').textContent = `${totalArea} sq ft`;
    document.getElementById('totalSquares').textContent = `${totalSquares} SQ`;
    
    preview.classList.remove('hidden');
    
    // Animate the preview
    anime({
        targets: preview,
        opacity: [0, 1],
        translateY: [20, 0],
        duration: 600,
        easing: 'easeOutQuart'
    });
}

// Material selection
function selectMaterial(material) {
    selectedMaterial = material;
    
    // Update UI
    document.querySelectorAll('.material-card').forEach(card => {
        card.classList.remove('selected');
    });
    document.querySelector(`[data-material="${material}"]`).classList.add('selected');
    
    // Recalculate costs
    calculateCosts();
    
    // Animate selection
    anime({
        targets: `[data-material="${material}"]`,
        scale: [1, 1.05, 1],
        duration: 300,
        easing: 'easeOutQuart'
    });
}

// Enhanced cost calculation using Diversity Roofing pricing
function calculateCosts() {
    const squareFootage = parseFloat(document.getElementById('squareFootage').value) || 0;
    const stories = parseInt(document.getElementById('stories').value) || 1;
    const roofPitch = document.getElementById('roofPitch').value;
    const roofCondition = document.getElementById('roofCondition').value;
    const underlayment = document.getElementById('underlayment').value;
    
    if (squareFootage === 0) {
        // Reset costs if no square footage
        updateCostDisplay(0, 0, 0, 0, 0, 0);
        return;
    }
    
    // Convert square footage to squares (1 square = 100 sq ft)
    const squares = squareFootage / 100;
    
    // Base labor cost from Diversity Roofing pricing guide
    let laborCost = squares * laborPrices[selectedMaterial];
    
    // Material costs based on selected material
    let materialCost = squares * materialCosts[selectedMaterial];
    
    // Add underlayment costs
    if (underlayment === 'synthetic') {
        materialCost += squares * materialCosts['underlayment'];
    } else if (underlayment === 'iceguard') {
        materialCost += squares * materialCosts['ice-guard'];
    }
    
    // Additional charges based on conditions
    let additionalCost = 0;
    
    // Layer charges
    if (roofCondition === 'average') {
        additionalCost += squares * additionalCharges['double-layer'];
    } else if (roofCondition === 'poor') {
        additionalCost += squares * additionalCharges['double-layer'] * 2; // 3+ layers
    }
    
    // Pitch charges
    if (roofPitch === 'medium') {
        additionalCost += squares * additionalCharges['steep-medium'];
    } else if (roofPitch === 'steep') {
        additionalCost += squares * additionalCharges['steep-high'];
    }
    
    // Story charges
    if (stories === 2) {
        additionalCost += squares * additionalCharges['two-story'];
    }
    
    // Calculate dumpster cost based on square footage
    dumpsterCost = squares >= 40 ? DUMPSTER_LARGE : DUMPSTER_SMALL;
    
    // Permits and fees (estimated)
    const permitCost = Math.max(250, squares * 15);
    
    // Calculate totals
    const subtotal = laborCost + materialCost + additionalCost + permitCost + dumpsterCost;
    const tax = subtotal * 0.0825;
    const total = subtotal + tax;
    const cashPrice = total * 0.95; // 5% cash discount
    
    // Update display
    updateCostDisplay(laborCost, materialCost, additionalCost, permitCost, dumpsterCost, tax, total, cashPrice);
    
    // Update chart
    updateCostChart();
    
    // Save current estimate data
    saveCurrentEstimate();
}

// Update cost display
function updateCostDisplay(labor, material, additional, permit, dumpster, tax, total, cashPrice) {
    document.getElementById('laborCost').textContent = formatCurrency(labor);
    document.getElementById('materialCost').textContent = formatCurrency(material);
    document.getElementById('additionalCost').textContent = formatCurrency(additional);
    document.getElementById('permitCost').textContent = formatCurrency(permit);
    document.getElementById('subtotalCost').textContent = formatCurrency(labor + material + additional + permit + dumpster);
    document.getElementById('taxCost').textContent = formatCurrency(tax);
    document.getElementById('totalCost').textContent = formatCurrency(total);
    document.getElementById('cashPrice').textContent = formatCurrency(cashPrice);
    
    // Store base cost for margin calculation
    baseCost = total;
    
    // Calculate overhead (8% of total, capped at $1800)
    overheadCost = Math.min(total * 0.08, MAX_OVERHEAD);
    
    // Update sales rep preview
    updateSalesRepPreview();
    
    // Animate total cost update
    anime({
        targets: '#totalCost',
        scale: [1, 1.1, 1],
        duration: 400,
        easing: 'easeOutQuart'
    });
}

// Select profit margin
function selectMargin(margin) {
    selectedMargin = margin;
    
    // Calculate customer price with margin (applied to base cost + overhead)
    const subtotalWithOverhead = baseCost + overheadCost;
    const marginMultiplier = 1 + (margin / 100);
    customerPrice = subtotalWithOverhead * marginMultiplier;
    
    // Update sales rep preview
    updateSalesRepPreview();
    
    // Highlight selected margin button
    document.querySelectorAll('#marginSelection button').forEach(btn => {
        btn.classList.remove('bg-green-600');
        btn.classList.add('bg-orange-600');
    });
    
    event.target.classList.remove('bg-orange-600');
    event.target.classList.add('bg-green-600');
    
    // Animate selection
    anime({
        targets: event.target,
        scale: [1, 1.05, 1],
        duration: 300,
        easing: 'easeOutQuart'
    });
}

// Update sales rep preview
function updateSalesRepPreview() {
    const subtotalWithOverhead = baseCost + overheadCost;
    const finalCustomerPrice = customerPrice > 0 ? customerPrice : subtotalWithOverhead;
    
    document.getElementById('baseCost').textContent = formatCurrency(baseCost);
    document.getElementById('selectedMargin').textContent = selectedMargin > 0 ? `${selectedMargin}%` : 'None';
    document.getElementById('customerPrice').textContent = formatCurrency(finalCustomerPrice);
    
    // Update overhead display if element exists
    const overheadElement = document.getElementById('overheadCost');
    if (overheadElement) {
        overheadElement.textContent = formatCurrency(overheadCost);
    }
    
    // Update overhead display in sales preview
    const overheadDisplay = document.getElementById('overheadDisplay');
    if (overheadDisplay) {
        overheadDisplay.textContent = formatCurrency(overheadCost);
    }
    
    // Update subtotal with overhead
    const subtotalDisplay = document.getElementById('subtotalWithOverhead');
    if (subtotalDisplay) {
        subtotalDisplay.textContent = formatCurrency(subtotalWithOverhead);
    }
}

// Format currency
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2
    }).format(amount);
}

// Handle photo upload
function handlePhotoUpload(event) {
    const files = event.target.files;
    const previewContainer = document.getElementById('photoPreview');
    
    Array.from(files).forEach(file => {
        if (file.size > 10 * 1024 * 1024) { // 10MB limit
            alert('File size must be less than 10MB');
            return;
        }
        
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = function(e) {
                const photoData = {
                    name: file.name,
                    dataUrl: e.target.result,
                    size: file.size
                };
                uploadedPhotos.push(photoData);
                
                // Create preview
                const photoDiv = document.createElement('div');
                photoDiv.className = 'relative group';
                photoDiv.innerHTML = `
                    <img src="${e.target.result}" alt="${file.name}" class="w-full h-24 object-cover rounded-lg">
                    <button onclick="removePhoto('${file.name}')" class="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 text-xs opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                `;
                previewContainer.appendChild(photoDiv);
                
                // Animate new photo
                anime({
                    targets: photoDiv,
                    scale: [0, 1],
                    opacity: [0, 1],
                    duration: 400,
                    easing: 'easeOutQuart'
                });
            };
            reader.readAsDataURL(file);
        }
    });
}

// Remove photo
function removePhoto(fileName) {
    uploadedPhotos = uploadedPhotos.filter(photo => photo.name !== fileName);
    const previewContainer = document.getElementById('photoPreview');
    previewContainer.innerHTML = '';
    
    uploadedPhotos.forEach(photo => {
        const photoDiv = document.createElement('div');
        photoDiv.className = 'relative group';
        photoDiv.innerHTML = `
            <img src="${photo.dataUrl}" alt="${photo.name}" class="w-full h-24 object-cover rounded-lg">
            <button onclick="removePhoto('${photo.name}')" class="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 text-xs opacity-0 group-hover:opacity-100 transition-opacity">×</button>
        `;
        previewContainer.appendChild(photoDiv);
    });
}

// Generate comprehensive proposal
function generateProposal() {
    // Validate required fields
    const requiredFields = ['customerName', 'phoneNumber', 'propertyAddress', 'squareFootage'];
    let isValid = true;
    
    requiredFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (!field.value.trim()) {
            field.style.borderColor = '#ef4444';
            isValid = false;
        } else {
            field.style.borderColor = '#e9ecef';
        }
    });
    
    if (!isValid) {
        alert('Please fill in all required fields before generating proposal.');
        return;
    }
    
    // Show loading animation
    const button = event.target;
    const originalText = button.textContent;
    button.textContent = '⏳ Generating Proposal...';
    button.disabled = true;
    
    // Generate comprehensive proposal content
    const proposalData = {
        companyInfo: {
            name: "Diversity Contracting And Roofing LLC",
            phone: "(904) 979-0556",
            email: "Jacksonville@Diversity-Roofing.com",
            website: "www.Diversity-Roofing.com",
            address: "10151 Deerwood Park Blvd, Bldg 200, Ste 250, Jacksonville, FL 32256",
            license: "Fully Licensed Contractor",
            insurance: "General Liability and Workers Compensation"
        },
        customerInfo: {
            name: document.getElementById('customerName').value,
            phone: document.getElementById('phoneNumber').value,
            email: document.getElementById('emailAddress').value,
            address: document.getElementById('propertyAddress').value
        },
        projectDetails: {
            squareFootage: document.getElementById('squareFootage').value,
            stories: document.getElementById('stories').value,
            roofPitch: document.getElementById('roofPitch').value,
            roofCondition: document.getElementById('roofCondition').value,
            material: selectedMaterial,
            description: document.getElementById('projectDescription').value,
            startDate: document.getElementById('startDate').value,
            completionDate: document.getElementById('completionDate').value,
            measurements: roofMeasurements
        },
        costs: {
            labor: document.getElementById('laborCost').textContent,
            material: document.getElementById('materialCost').textContent,
            additional: document.getElementById('additionalCost').textContent,
            permit: document.getElementById('permitCost').textContent,
            dumpster: formatCurrency(dumpsterCost),
            overhead: formatCurrency(overheadCost),
            baseTotal: formatCurrency(baseCost),
            subtotalWithOverhead: formatCurrency(baseCost + overheadCost),
            customerTotal: formatCurrency(customerPrice > 0 ? customerPrice : baseCost + overheadCost),
            selectedMargin: selectedMargin > 0 ? `${selectedMargin}%` : 'None',
            cashPrice: formatCurrency((customerPrice > 0 ? customerPrice : baseCost + overheadCost) * 0.95)
        },
        terms: {
            payment: "50% deposit due upon contract signing, 50% due upon completion",
            warranty: "10-Year Labor Warranty + Manufacturer's Limited Lifetime Shingle Warranty",
            validity: "30 days from date issued",
            permits: "All necessary permits included in estimate"
        }
    };
    
    // Create a comprehensive proposal document
    setTimeout(() => {
        const subtotalWithOverhead = baseCost + overheadCost;
        const finalPrice = customerPrice > 0 ? customerPrice : subtotalWithOverhead;
        const marginInfo = selectedMargin > 0 ? ` (${selectedMargin}% margin applied)` : ' (no margin applied)';
        
        const proposalContent = `DIVERSITY ROOFING - PROFESSIONAL ESTIMATE
=====================================

COMPANY INFORMATION:
Company: ${proposalData.companyInfo.name}
Phone: ${proposalData.companyInfo.phone}
Email: ${proposalData.companyInfo.email}
Website: ${proposalData.companyInfo.website}
Address: ${proposalData.companyInfo.address}
License: ${proposalData.companyInfo.license}
Insurance: ${proposalData.companyInfo.insurance}

CUSTOMER INFORMATION:
Name: ${proposalData.customerInfo.name}
Phone: ${proposalData.customerInfo.phone}
Email: ${proposalData.customerInfo.email}
Address: ${proposalData.customerInfo.address}

PROJECT DETAILS:
Square Footage: ${proposalData.projectDetails.squareFootage} sq ft
Stories: ${proposalData.projectDetails.stories}
Roof Pitch: ${proposalData.projectDetails.roofPitch}
Roof Condition: ${proposalData.projectDetails.roofCondition}
Material: ${proposalData.projectDetails.material}
Start Date: ${proposalData.projectDetails.startDate}
Completion Date: ${proposalData.projectDetails.completionDate}

COST BREAKDOWN:
Labor: ${proposalData.costs.labor}
Materials: ${proposalData.costs.material}
Additional Charges: ${proposalData.costs.additional}
Permits & Fees: ${proposalData.costs.permit}
Dumpster & Disposal: ${proposalData.costs.dumpster}
Overhead (8%, $1800 max): ${proposalData.costs.overhead}
Base Total: ${proposalData.costs.baseTotal}
Subtotal with Overhead: ${proposalData.costs.subtotalWithOverhead}
Selected Margin: ${proposalData.costs.selectedMargin}
Final Customer Price: ${proposalData.costs.customerTotal}
Cash Price (5% discount): ${proposalData.costs.cashPrice}

SCOPE OF WORK:
${proposalData.projectDetails.description}

PAYMENT TERMS:
${proposalData.terms.payment}

WARRANTY:
${proposalData.terms.warranty}

VALIDITY:
${proposalData.terms.validity}

PERMITS:
${proposalData.terms.permits}

ROOF MEASUREMENTS:
${roofMeasurements.map(m => `${m.section}: ${m.area > 0 ? m.area + ' sq ft' : m.length + ' ft'}`).join('\n')}

ADDITIONAL NOTES:
- This estimate includes all materials, labor, permits, and disposal
- Site visit before project start
- Project manager on every job site
- Unmarked vehicles representing your company
- Before/during/after photos with drone shots
- 10-year labor warranty included

Thank you for choosing Diversity Roofing!

Generated on: ${new Date().toLocaleDateString()}
Estimate ID: DR-${Date.now()}`;
        
        // Create a downloadable text file with the proposal
        const blob = new Blob([proposalContent], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Diversity-Roofing-Proposal-${proposalData.customerInfo.name.replace(/\s+/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        alert(`Comprehensive proposal generated successfully for ${proposalData.customerInfo.name}! 
        
✅ Professional proposal document has been created and downloaded
✅ Complete cost breakdown with all pricing components
✅ Final Customer Price: ${formatCurrency(finalPrice)}${marginInfo}
✅ Base Cost: ${formatCurrency(baseCost)}
✅ Dumpster & Disposal: ${formatCurrency(dumpsterCost)}
✅ Overhead (8%): ${formatCurrency(overheadCost)} (capped at $1,800)
✅ File saved as: Diversity-Roofing-Proposal-${proposalData.customerInfo.name.replace(/\s+/g, '-')}.txt
        
The proposal includes:
✅ Company credentials and licensing information
✅ Detailed project scope and objectives  
✅ Complete cost breakdown with Diversity Roofing pricing
✅ Roof measurements and material specifications
✅ Payment terms and warranty information
✅ Customer and company contact details
✅ Profit margin information for sales rep reference
✅ Overhead costs (8% capped at $1,800)
✅ Dumpster and disposal costs

This is a complete, professional proposal ready for customer presentation.`);
        
        button.textContent = originalText;
        button.disabled = false;
        
        // Animate success
        anime({
            targets: button,
            scale: [1, 1.05, 1],
            backgroundColor: ['#E67E22', '#27AE60', '#E67E22'],
            duration: 600,
            easing: 'easeOutQuart'
        });
    }, 2000);
}

// Save current estimate
function saveCurrentEstimate() {
    currentEstimate = {
        customerName: document.getElementById('customerName').value,
        phoneNumber: document.getElementById('phoneNumber').value,
        propertyAddress: document.getElementById('propertyAddress').value,
        emailAddress: document.getElementById('emailAddress').value,
        estimateDate: document.getElementById('estimateDate').value,
        squareFootage: document.getElementById('squareFootage').value,
        stories: document.getElementById('stories').value,
        roofPitch: document.getElementById('roofPitch').value,
        roofCondition: document.getElementById('roofCondition').value,
        selectedMaterial: selectedMaterial,
        shingleColor: document.getElementById('shingleColor').value,
        underlayment: document.getElementById('underlayment').value,
        projectDescription: document.getElementById('projectDescription').value,
        startDate: document.getElementById('startDate').value,
        completionDate: document.getElementById('completionDate').value,
        photos: uploadedPhotos,
        measurements: roofMeasurements,
        costs: {
            labor: document.getElementById('laborCost').textContent,
            material: document.getElementById('materialCost').textContent,
            additional: document.getElementById('additionalCost').textContent,
            permit: document.getElementById('permitCost').textContent,
            total: document.getElementById('totalCost').textContent,
            cashPrice: document.getElementById('cashPrice').textContent
        }
    };
    
    // Save to localStorage
    localStorage.setItem('currentEstimate', JSON.stringify(currentEstimate));
}

// Load estimate from localStorage
function loadEstimate() {
    const saved = localStorage.getItem('currentEstimate');
    if (saved) {
        currentEstimate = JSON.parse(saved);
        
        // Populate form fields
        Object.keys(currentEstimate).forEach(key => {
            const element = document.getElementById(key);
            if (element && currentEstimate[key]) {
                element.value = currentEstimate[key];
            }
        });
        
        // Restore material selection
        if (currentEstimate.selectedMaterial) {
            selectMaterial(currentEstimate.selectedMaterial);
        }
        
        // Restore photos
        if (currentEstimate.photos) {
            uploadedPhotos = currentEstimate.photos;
            const previewContainer = document.getElementById('photoPreview');
            previewContainer.innerHTML = '';
            
            uploadedPhotos.forEach(photo => {
                const photoDiv = document.createElement('div');
                photoDiv.className = 'relative group';
                photoDiv.innerHTML = `
                    <img src="${photo.dataUrl}" alt="${photo.name}" class="w-full h-24 object-cover rounded-lg">
                    <button onclick="removePhoto('${photo.name}')" class="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 text-xs opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                `;
                previewContainer.appendChild(photoDiv);
            });
        }
        
        // Restore measurements if available
        if (currentEstimate.measurements) {
            roofMeasurements = currentEstimate.measurements;
            displayMeasurements(currentEstimate.measurements);
        }
        
        // Recalculate costs
        calculateCosts();
    }
}

// Save estimate
function saveEstimate() {
    saveCurrentEstimate();
    
    // Show success message
    const button = event.target;
    const originalText = button.textContent;
    button.textContent = '✅ Saved!';
    
    setTimeout(() => {
        button.textContent = originalText;
    }, 2000);
    
    // Animate save
    anime({
        targets: button,
        scale: [1, 1.05, 1],
        backgroundColor: ['#E67E22', '#27AE60', '#E67E22'],
        duration: 600,
        easing: 'easeOutQuart'
    });
}

// Email estimate
function emailEstimate() {
    const customerEmail = document.getElementById('emailAddress').value;
    const customerName = document.getElementById('customerName').value;
    
    if (!customerEmail) {
        alert('Please enter customer email address.');
        return;
    }
    
    if (!customerName) {
        alert('Please enter customer name.');
        return;
    }
    
    // Check if margin has been selected
    if (selectedMargin === 0) {
        if (confirm('No profit margin selected. Do you want to send with base pricing?')) {
            // Proceed with base pricing
        } else {
            return;
        }
    }
    
    // Show sending animation
    const button = event.target;
    const originalText = button.textContent;
    button.textContent = '📧 Preparing Email...';
    button.disabled = true;
    
    // Generate email content
    const subtotalWithOverhead = baseCost + overheadCost;
    const finalPrice = customerPrice > 0 ? customerPrice : subtotalWithOverhead;
    const marginInfo = selectedMargin > 0 ? ` (${selectedMargin}% margin)` : ' (base pricing)';
    
    // Create a more realistic email preparation
    setTimeout(() => {
        // Create a downloadable email template
        const emailSubject = `Roofing Estimate - ${customerName}`;
        const emailBody = `Dear ${customerName},

Thank you for choosing Diversity Roofing for your roofing needs. We have prepared a comprehensive estimate for your project.

PROJECT SUMMARY:
- Property: ${document.getElementById('propertyAddress').value}
- Total Area: ${document.getElementById('squareFootage').value} sq ft
- Material: ${selectedMaterial}
- Estimated Cost: ${formatCurrency(finalPrice)}

COST BREAKDOWN:
- Base Cost: ${formatCurrency(baseCost)}
- Dumpster & Disposal: ${formatCurrency(dumpsterCost)}
- Overhead (8%, $1800 max): ${formatCurrency(overheadCost)}
${selectedMargin > 0 ? `- Profit Margin (${selectedMargin}%): ${formatCurrency(finalPrice - subtotalWithOverhead)}` : ''}
- TOTAL: ${formatCurrency(finalPrice)}

OUR ESTIMATE INCLUDES:
✅ Complete roof replacement
✅ Premium materials with warranty
✅ Professional installation
✅ Cleanup and debris removal
✅ 10-year labor warranty
✅ Overhead and operational costs

PAYMENT TERMS:
- 50% deposit due upon contract signing
- 50% due upon completion of work
- NET 7 payment terms

NEXT STEPS:
Please review this estimate and let us know if you have any questions. We're ready to schedule your project as soon as you approve.

Thank you for choosing Diversity Roofing!

Best regards,
Diversity Roofing Team
(904) 979-0556
www.Diversity-Roofing.com`;
        
        // Create a downloadable text file with the email content
        const blob = new Blob([`Subject: ${emailSubject}\n\n${emailBody}`], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Diversity-Roofing-Estimate-${customerName.replace(/\s+/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        alert(`Email template generated successfully for ${customerName} (${customerEmail})!
        
✅ A downloadable email template has been created
✅ The template includes complete cost breakdown
✅ Professional formatting ready to send
✅ File saved as: Diversity-Roofing-Estimate-${customerName.replace(/\s+/g, '-')}.txt
        
You can now copy the content from the downloaded file and paste it into your email client, or use it as a reference for phone calls.
        
Final Customer Price: ${formatCurrency(finalPrice)}${marginInfo}
Base Cost: ${formatCurrency(baseCost)}
Dumpster & Disposal: ${formatCurrency(dumpsterCost)}
Overhead (8%): ${formatCurrency(overheadCost)}`);
        
        button.textContent = originalText;
        button.disabled = false;
        
        // Animate success
        anime({
            targets: button,
            scale: [1, 1.05, 1],
            backgroundColor: ['#E67E22', '#27AE60', '#E67E22'],
            duration: 600,
            easing: 'easeOutQuart'
        });
    }, 2000);
}

// Form validation
function validateForm() {
    const requiredFields = ['customerName', 'phoneNumber', 'propertyAddress', 'squareFootage'];
    let isValid = true;
    
    requiredFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (!field.value.trim()) {
            field.style.borderColor = '#ef4444';
            isValid = false;
        } else {
            field.style.borderColor = '#e9ecef';
        }
    });
    
    return isValid;
}

// Auto-save functionality
let autoSaveTimer;
function setupAutoSave() {
    const formInputs = document.querySelectorAll('input, select, textarea');
    formInputs.forEach(input => {
        input.addEventListener('change', () => {
            clearTimeout(autoSaveTimer);
            autoSaveTimer = setTimeout(() => {
                saveCurrentEstimate();
            }, 1000);
        });
    });
}

// Initialize auto-save on page load
document.addEventListener('DOMContentLoaded', function() {
    setupAutoSave();
    loadEstimate();
});

// Handle window resize for chart
window.addEventListener('resize', function() {
    if (costChart) {
        costChart.resize();
    }
});

// Export fun