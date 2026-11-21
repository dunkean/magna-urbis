//! Slope as a density and a tissue switch: open land on a slope is housed less densely, and
//! above the grade a plain house stands on it is built in terraces. Slope never closes land;
//! only cliffs do.

use magna_urbis_geom::{Point, Shape, bbox, centroid, contains};

use super::{Survey, SurveyCell};

/// Slope facts of one quarter outline, averaged over the survey cells whose centres it holds.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct QuarterSlope {
    /// Mean ground grade of its open cells, rise over run.
    pub mean_grade: f64,
    /// Share of its open cells that are terraced.
    pub terraced_share: f64,
    /// Mean slope density of its open cells, 1 on flat land.
    pub density: f64,
}

impl QuarterSlope {
    /// Whether most of the quarter is terraced, so that it takes the terraced tissue.
    pub fn terraced(&self) -> bool {
        self.terraced_share >= 0.5
    }
}

impl Survey {
    /// Share of flat-land housing density a cell keeps: 1 up to the spec's dense grade, falling
    /// smoothly to the terrace density at the terrace limit and staying there up to the cliff
    /// limit; 0 on closed land.
    pub fn slope_density(&self, cell: &SurveyCell) -> f64 {
        if cell.closed {
            return 0.0;
        }
        let spec = &self.spec;
        let upper = spec.terrace_limit.max(spec.dense_grade + 1e-9);
        let fall = smooth(cell.slope, spec.dense_grade, upper);
        1.0 - (1.0 - spec.terrace_density) * fall
    }

    /// Whether an open cell is too steep for a plain house, so that it is built in terraces.
    pub fn terraced(&self, cell: &SurveyCell) -> bool {
        !cell.closed && cell.slope > self.spec.house_grade
    }

    /// Slope facts of the open cells inside `outline`; the cell under its centroid stands for
    /// an outline too small to hold a cell centre. A quarter on closed land reads as flat.
    pub fn quarter_slope(&self, outline: &Shape) -> QuarterSlope {
        let step = self.cell_size();
        let (x0, y0, x1, y1) = bbox(outline);
        let mut sum = Sum::default();
        if x0.is_finite() && y0.is_finite() && x1.is_finite() && y1.is_finite() {
            // Survey cells are centred on multiples of the step from the survey centre.
            let centre = self.center();
            let first = |low: f64, origin: f64| origin + ((low - origin) / step).ceil() * step;
            let mut y = first(y0, centre.y);
            while y <= y1 {
                let mut x = first(x0, centre.x);
                while x <= x1 {
                    let p = Point { x, y };
                    if contains(outline, p)
                        && let Some(cell) = self.cell_at(p)
                    {
                        sum.add(self, cell);
                    }
                    x += step;
                }
                y += step;
            }
        }
        if sum.count == 0
            && let Some(cell) = self.cell_at(centroid(outline))
        {
            sum.add(self, cell);
        }
        if sum.count == 0 {
            return QuarterSlope {
                mean_grade: 0.0,
                terraced_share: 0.0,
                density: 1.0,
            };
        }
        let n = sum.count as f64;
        QuarterSlope {
            mean_grade: sum.grade / n,
            terraced_share: sum.terraced as f64 / n,
            density: sum.density / n,
        }
    }
}

/// Running sums over the open cells of a quarter.
#[derive(Default)]
struct Sum {
    count: usize,
    grade: f64,
    terraced: usize,
    density: f64,
}

impl Sum {
    fn add(&mut self, survey: &Survey, cell: &SurveyCell) {
        if cell.closed {
            return;
        }
        self.count += 1;
        self.grade += cell.slope;
        self.terraced += usize::from(survey.terraced(cell));
        self.density += survey.slope_density(cell);
    }
}

/// Smoothstep of `x` from `a` to `b`.
fn smooth(x: f64, a: f64, b: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
